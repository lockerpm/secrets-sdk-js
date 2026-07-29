import {
  spawn,
  spawnSync,
  type ChildProcessWithoutNullStreams,
  type SpawnOptionsWithoutStdio,
} from 'node:child_process'
import { lstatSync, realpathSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

export const ProcessFailureReason = {
  ABORTED: 'aborted',
  BUFFER_LIMIT: 'buffer_limit',
  ENCODING: 'encoding',
  EXIT: 'exit',
  SPAWN: 'spawn',
  STDIN: 'stdin',
  TIMEOUT: 'timeout',
} as const

export type ProcessFailureReason =
  (typeof ProcessFailureReason)[keyof typeof ProcessFailureReason]

export class ProcessFailure extends Error {
  readonly reason: ProcessFailureReason
  readonly exitCode: number | null
  readonly signal: NodeJS.Signals | null
  override readonly cause?: unknown

  constructor(
    reason: ProcessFailureReason,
    options?: {
      exitCode?: number | null
      signal?: NodeJS.Signals | null
      cause?: unknown
    },
  ) {
    super(`Locker CLI process failed (${reason})`)
    this.name = 'ProcessFailure'
    this.reason = reason
    this.exitCode = options?.exitCode ?? null
    this.signal = options?.signal ?? null
    this.cause = options?.cause
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

export type ProcessExecutionOptions = {
  timeoutMs: number
  maxStdoutBytes: number
  maxStderrBytes: number
  signal?: AbortSignal
}

export type ProcessExecutionResult = {
  stdout: string
  exitCode: number
  signal: NodeJS.Signals | null
  durationMs: number
}

const MAX_PROTOCOL_STDOUT_BYTES = 20 * 1024 * 1024
const SYNC_HELPER_TIMEOUT_EXIT = 70
const SYNC_HELPER_STDOUT_EXIT = 71
const SYNC_HELPER_STDERR_EXIT = 72
const SYNC_HELPER_TRANSPORT_EXIT = 73
const SYNC_HELPER_CHILD_EXIT = 74
const SYNC_HELPER_PID_PREFIX = 'LOCKER_SYNC_CHILD_PID:'
const SYNC_HELPER_EXIT_PREFIX = 'LOCKER_SYNC_CHILD_EXIT:'
const SYNC_HELPER_GUARD_MS = 5_000
const WINDOWS_TASKKILL_DEVICE_PATH =
  '\\\\?\\GLOBALROOT\\SystemRoot\\System32\\taskkill.exe'

export function windowsTaskkillPath(): string | undefined {
  if (process.platform !== 'win32') {
    return undefined
  }
  try {
    const resolved = realpathSync.native(WINDOWS_TASKKILL_DEVICE_PATH)
    const metadata = lstatSync(resolved)
    if (
      !path.win32.isAbsolute(resolved) ||
      path.win32.basename(resolved).toLowerCase() !== 'taskkill.exe' ||
      metadata.isSymbolicLink() ||
      !metadata.isFile()
    ) {
      return undefined
    }
    return resolved
  } catch {
    return undefined
  }
}

// spawnSync cannot expose the child PID and only terminates the direct child
// on timeout. A small Node helper owns the real CLI process, places it in a
// POSIX process group (or uses taskkill /T on Windows), enforces both byte
// limits, and reports the PID so this parent can still kill the tree if the
// helper itself exceeds its guard deadline.
const SYNC_HELPER_SOURCE = String.raw`
'use strict';
const { spawn, spawnSync } = require('node:child_process');
const cfg = JSON.parse(process.argv[1]);
const PID_PREFIX = '${SYNC_HELPER_PID_PREFIX}';
const EXIT_PREFIX = '${SYNC_HELPER_EXIT_PREFIX}';
let child;
let failure = 0;
let forceTimer;
let timeoutTimer;
const stdout = [];
let stdoutBytes = 0;
let stderrBytes = 0;
const wipe = () => {
  for (const chunk of stdout) chunk.fill(0);
  stdout.length = 0;
};
const killTree = (force) => {
  if (!child || child.pid === undefined) return;
  if (process.platform === 'win32') {
    try {
      if (typeof cfg.taskkillPath !== 'string') throw new Error('no taskkill');
      spawnSync(cfg.taskkillPath, ['/pid', String(child.pid), '/T', '/F'], {
        env: process.env,
        shell: false,
        stdio: 'ignore',
        timeout: 4000,
        windowsHide: true,
      });
      return;
    } catch {}
  } else {
    try {
      process.kill(-child.pid, force ? 'SIGKILL' : 'SIGTERM');
      return;
    } catch {}
  }
  try {
    child.kill(force ? 'SIGKILL' : 'SIGTERM');
  } catch {}
};
const fail = (code) => {
  if (failure !== 0) return;
  failure = code;
  wipe();
  killTree(false);
  forceTimer = setTimeout(() => killTree(true), 250);
};
const finish = (code) => {
  clearTimeout(timeoutTimer);
  clearTimeout(forceTimer);
  if (failure !== 0) {
    process.exitCode = failure;
    return;
  }
  // A valid CLI exchange must not leave descendants running.
  killTree(true);
  if (code !== 0) {
    process.stderr.write(EXIT_PREFIX + String(code ?? -1) + '\n');
    process.exitCode = ${SYNC_HELPER_CHILD_EXIT};
    return;
  }
  const output = Buffer.concat(stdout, stdoutBytes);
  wipe();
  process.stdout.write(output, () => {
    output.fill(0);
    process.exitCode = 0;
  });
};
try {
  child = spawn(cfg.executable, cfg.args, {
    detached: process.platform !== 'win32',
    env: process.env,
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
} catch {
  process.exit(${SYNC_HELPER_TRANSPORT_EXIT});
}
process.stderr.write(PID_PREFIX + String(child.pid) + '\n');
timeoutTimer = setTimeout(() => fail(${SYNC_HELPER_TIMEOUT_EXIT}), cfg.timeoutMs);
child.once('error', () => fail(${SYNC_HELPER_TRANSPORT_EXIT}));
child.stdin.once('error', () => fail(${SYNC_HELPER_TRANSPORT_EXIT}));
process.stdin.once('error', () => fail(${SYNC_HELPER_TRANSPORT_EXIT}));
process.stdin.pipe(child.stdin);
child.stdout.on('data', (chunk) => {
  if (failure !== 0) {
    chunk.fill(0);
    return;
  }
  stdoutBytes += chunk.length;
  if (stdoutBytes > cfg.maxStdoutBytes) {
    chunk.fill(0);
    fail(${SYNC_HELPER_STDOUT_EXIT});
    return;
  }
  stdout.push(chunk);
});
child.stderr.on('data', (chunk) => {
  stderrBytes += chunk.length;
  chunk.fill(0);
  if (stderrBytes > cfg.maxStderrBytes) fail(${SYNC_HELPER_STDERR_EXIT});
});
child.once('close', (code) => finish(code));
process.once('exit', () => {
  if (child && child.exitCode === null) killTree(true);
  wipe();
});
`

export interface ProcessRunner {
  run(
    executable: string,
    args: readonly string[],
    stdin: Buffer,
    options: ProcessExecutionOptions,
  ): Promise<ProcessExecutionResult>

  runSync(
    executable: string,
    args: readonly string[],
    stdin: Buffer,
    options: ProcessExecutionOptions,
  ): ProcessExecutionResult
}

const SAFE_ENVIRONMENT_VARIABLES = new Set([
  'ALL_PROXY',
  'APPDATA',
  'COMSPEC',
  'HOME',
  'HOMEDRIVE',
  'HOMEPATH',
  'HTTPS_PROXY',
  'HTTP_PROXY',
  'LANG',
  'LC_ALL',
  'LOCALAPPDATA',
  'NO_PROXY',
  'PATH',
  'PATHEXT',
  'SSL_CERT_DIR',
  'SSL_CERT_FILE',
  'SYSTEMROOT',
  'TEMP',
  'TMP',
  'TMPDIR',
  'USERPROFILE',
  'WINDIR',
  'XDG_CACHE_HOME',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
])

export function sanitizedEnvironment(
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {}
  for (const [name, value] of Object.entries(source)) {
    if (
      value !== undefined &&
      SAFE_ENVIRONMENT_VARIABLES.has(name.toUpperCase())
    ) {
      result[name] = value
    }
  }
  return result
}

function validateOptions(options: ProcessExecutionOptions): void {
  if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new RangeError('timeoutMs must be a positive safe integer')
  }
  if (
    !Number.isSafeInteger(options.maxStdoutBytes) ||
    options.maxStdoutBytes <= 0 ||
    !Number.isSafeInteger(options.maxStderrBytes) ||
    options.maxStderrBytes <= 0
  ) {
    throw new RangeError('process buffer limits must be positive safe integers')
  }
  if (options.maxStdoutBytes > MAX_PROTOCOL_STDOUT_BYTES) {
    throw new RangeError(
      `maxStdoutBytes must not exceed ${MAX_PROTOCOL_STDOUT_BYTES} bytes`,
    )
  }
}

function terminateProcessTree(
  child: ChildProcessWithoutNullStreams,
  force = false,
): void {
  if (child.pid === undefined || (!force && child.killed)) {
    return
  }

  if (process.platform === 'win32') {
    try {
      const taskkillPath = windowsTaskkillPath()
      if (taskkillPath === undefined) {
        throw new Error('Windows taskkill utility is unavailable')
      }
      const result = spawnSync(
        taskkillPath,
        ['/pid', String(child.pid), '/T', '/F'],
        {
          env: sanitizedEnvironment(),
          shell: false,
          stdio: 'ignore',
          timeout: 5_000,
          windowsHide: true,
        },
      )
      if (!result.error && result.status === 0) {
        return
      }
    } catch {
      // Fall through to the direct-process kill.
    }
  } else {
    try {
      process.kill(-child.pid, force ? 'SIGKILL' : 'SIGTERM')
      if (!force) {
        const forceTimer = setTimeout(
          () => terminateProcessTree(child, true),
          250,
        )
        forceTimer.unref()
      }
      return
    } catch {
      // Fall through to the direct-process kill.
    }
  }

  try {
    child.kill(force ? 'SIGKILL' : 'SIGTERM')
  } catch {
    // The process may already have exited.
  }
}

function helperChildPID(stderr: Buffer | string | null): number | undefined {
  const text = Buffer.isBuffer(stderr) ? stderr.toString('utf8') : stderr
  if (typeof text !== 'string') {
    return undefined
  }
  const match = new RegExp(`${SYNC_HELPER_PID_PREFIX}(\\d+)`).exec(text)
  if (!match) {
    return undefined
  }
  const pid = Number(match[1])
  return Number.isSafeInteger(pid) && pid > 0 ? pid : undefined
}

function helperChildExitCode(stderr: Buffer | string | null): number | null {
  const text = Buffer.isBuffer(stderr) ? stderr.toString('utf8') : stderr
  if (typeof text !== 'string') {
    return null
  }
  const match = new RegExp(`${SYNC_HELPER_EXIT_PREFIX}(-?\\d+)`).exec(text)
  if (!match) {
    return null
  }
  const exitCode = Number(match[1])
  return Number.isSafeInteger(exitCode) ? exitCode : null
}

function terminateProcessTreeByPID(pid: number): void {
  if (process.platform === 'win32') {
    try {
      const taskkillPath = windowsTaskkillPath()
      if (taskkillPath === undefined) {
        throw new Error('Windows taskkill utility is unavailable')
      }
      spawnSync(taskkillPath, ['/pid', String(pid), '/T', '/F'], {
        env: sanitizedEnvironment(),
        shell: false,
        stdio: 'ignore',
        timeout: 5_000,
        windowsHide: true,
      })
      return
    } catch {
      // Fall through to the direct-process kill.
    }
  } else {
    try {
      process.kill(-pid, 'SIGKILL')
      return
    } catch {
      // Fall through to the direct-process kill.
    }
  }
  try {
    process.kill(pid, 'SIGKILL')
  } catch {
    // The process may already have exited.
  }
}

export class NodeProcessRunner implements ProcessRunner {
  async run(
    executable: string,
    args: readonly string[],
    stdin: Buffer,
    options: ProcessExecutionOptions,
  ): Promise<ProcessExecutionResult> {
    validateOptions(options)
    if (options.signal?.aborted) {
      stdin.fill(0)
      throw new ProcessFailure(ProcessFailureReason.ABORTED)
    }

    const startedAt = Date.now()
    const spawnOptions: SpawnOptionsWithoutStdio = {
      detached: process.platform !== 'win32',
      env: sanitizedEnvironment(),
      shell: false,
      windowsHide: true,
    }

    return await new Promise<ProcessExecutionResult>((resolve, reject) => {
      let child: ChildProcessWithoutNullStreams
      try {
        child = spawn(executable, [...args], {
          ...spawnOptions,
          stdio: ['pipe', 'pipe', 'pipe'],
        })
      } catch (error) {
        stdin.fill(0)
        reject(new ProcessFailure(ProcessFailureReason.SPAWN, { cause: error }))
        return
      }

      let settled = false
      let stdoutBytes = 0
      let stderrBytes = 0
      const stdoutChunks: Buffer[] = []

      const wipeStdout = () => {
        for (const chunk of stdoutChunks) {
          chunk.fill(0)
        }
        stdoutChunks.length = 0
      }
      const cleanup = () => {
        clearTimeout(timeout)
        options.signal?.removeEventListener('abort', onAbort)
        stdin.fill(0)
      }
      const fail = (failure: ProcessFailure, kill = true) => {
        if (settled) {
          return
        }
        settled = true
        cleanup()
        wipeStdout()
        if (kill) {
          terminateProcessTree(child)
        }
        reject(failure)
      }
      const onAbort = () => {
        fail(new ProcessFailure(ProcessFailureReason.ABORTED))
      }
      const timeout = setTimeout(() => {
        fail(new ProcessFailure(ProcessFailureReason.TIMEOUT))
      }, options.timeoutMs)
      timeout.unref()
      options.signal?.addEventListener('abort', onAbort, { once: true })
      if (options.signal?.aborted) {
        onAbort()
        return
      }

      child.once('error', (error) => {
        fail(
          new ProcessFailure(ProcessFailureReason.SPAWN, { cause: error }),
          false,
        )
      })
      child.stdin.once('error', (error) => {
        fail(new ProcessFailure(ProcessFailureReason.STDIN, { cause: error }))
      })
      child.stdout.on('data', (chunk: Buffer | string) => {
        if (settled) {
          if (Buffer.isBuffer(chunk)) {
            chunk.fill(0)
          }
          return
        }
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        stdoutBytes += buffer.length
        if (stdoutBytes > options.maxStdoutBytes) {
          buffer.fill(0)
          fail(new ProcessFailure(ProcessFailureReason.BUFFER_LIMIT))
          return
        }
        stdoutChunks.push(buffer)
      })
      child.stderr.on('data', (chunk: Buffer | string) => {
        if (settled) {
          if (Buffer.isBuffer(chunk)) {
            chunk.fill(0)
          }
          return
        }
        stderrBytes += Buffer.byteLength(chunk)
        if (Buffer.isBuffer(chunk)) {
          chunk.fill(0)
        }
        if (stderrBytes > options.maxStderrBytes) {
          fail(new ProcessFailure(ProcessFailureReason.BUFFER_LIMIT))
        }
      })
      child.once('close', (code, signal) => {
        if (settled) {
          return
        }
        if (code !== 0) {
          fail(
            new ProcessFailure(ProcessFailureReason.EXIT, {
              exitCode: code,
              signal,
            }),
          )
          return
        }
        const output = Buffer.concat(stdoutChunks, stdoutBytes)
        let stdout: string
        try {
          stdout = new TextDecoder('utf-8', { fatal: true }).decode(output)
        } catch (error) {
          output.fill(0)
          fail(
            new ProcessFailure(ProcessFailureReason.ENCODING, {
              cause: error,
            }),
          )
          return
        }
        output.fill(0)
        // The signed CLI is not expected to leave descendants behind. Kill
        // any surviving process-group members before accepting its response.
        terminateProcessTree(child, true)
        settled = true
        cleanup()
        wipeStdout()
        resolve({
          stdout,
          exitCode: code,
          signal,
          durationMs: Date.now() - startedAt,
        })
      })

      try {
        child.stdin.end(stdin)
      } catch (error) {
        fail(new ProcessFailure(ProcessFailureReason.STDIN, { cause: error }))
      }
    })
  }

  runSync(
    executable: string,
    args: readonly string[],
    stdin: Buffer,
    options: ProcessExecutionOptions,
  ): ProcessExecutionResult {
    validateOptions(options)
    if (options.signal?.aborted) {
      stdin.fill(0)
      throw new ProcessFailure(ProcessFailureReason.ABORTED)
    }

    const startedAt = Date.now()
    let result: ReturnType<typeof spawnSync>
    try {
      const helperConfiguration = JSON.stringify({
        executable,
        args: [...args],
        taskkillPath: windowsTaskkillPath(),
        timeoutMs: options.timeoutMs,
        maxStdoutBytes: options.maxStdoutBytes,
        maxStderrBytes: options.maxStderrBytes,
      })
      result = spawnSync(
        process.execPath,
        ['-e', SYNC_HELPER_SOURCE, helperConfiguration],
        {
          env: sanitizedEnvironment(),
          input: stdin,
          killSignal: 'SIGKILL',
          maxBuffer:
            Math.max(options.maxStdoutBytes, options.maxStderrBytes) +
            64 * 1024,
          shell: false,
          timeout: options.timeoutMs + SYNC_HELPER_GUARD_MS,
          windowsHide: true,
        },
      )
    } finally {
      stdin.fill(0)
    }

    try {
      if (result.error) {
        const code = (result.error as NodeJS.ErrnoException).code
        const childPID = helperChildPID(result.stderr)
        if (childPID !== undefined) {
          terminateProcessTreeByPID(childPID)
        }
        const reason =
          code === 'ETIMEDOUT'
            ? ProcessFailureReason.TIMEOUT
            : code === 'ENOBUFS'
              ? ProcessFailureReason.BUFFER_LIMIT
              : ProcessFailureReason.SPAWN
        throw new ProcessFailure(reason, { cause: result.error })
      }
      if (result.status === SYNC_HELPER_TIMEOUT_EXIT) {
        throw new ProcessFailure(ProcessFailureReason.TIMEOUT)
      }
      if (
        result.status === SYNC_HELPER_STDOUT_EXIT ||
        result.status === SYNC_HELPER_STDERR_EXIT
      ) {
        throw new ProcessFailure(ProcessFailureReason.BUFFER_LIMIT)
      }
      if (result.status === SYNC_HELPER_TRANSPORT_EXIT) {
        throw new ProcessFailure(ProcessFailureReason.SPAWN)
      }
      if (result.status === SYNC_HELPER_CHILD_EXIT) {
        throw new ProcessFailure(ProcessFailureReason.EXIT, {
          exitCode: helperChildExitCode(result.stderr),
          signal: result.signal,
        })
      }
      if (
        (result.stdout?.length ?? 0) > options.maxStdoutBytes ||
        (result.stderr?.length ?? 0) > options.maxStderrBytes
      ) {
        throw new ProcessFailure(ProcessFailureReason.BUFFER_LIMIT)
      }
      if (result.status !== 0) {
        throw new ProcessFailure(ProcessFailureReason.EXIT, {
          exitCode: result.status,
          signal: result.signal,
        })
      }

      let stdout = ''
      try {
        if (Buffer.isBuffer(result.stdout)) {
          stdout = new TextDecoder('utf-8', { fatal: true }).decode(
            result.stdout,
          )
        } else if (typeof result.stdout === 'string') {
          stdout = result.stdout
        }
      } catch (error) {
        throw new ProcessFailure(ProcessFailureReason.ENCODING, {
          cause: error,
        })
      }
      return {
        stdout,
        exitCode: result.status,
        signal: result.signal,
        durationMs: Date.now() - startedAt,
      }
    } finally {
      if (Buffer.isBuffer(result.stdout)) {
        result.stdout.fill(0)
      }
      if (Buffer.isBuffer(result.stderr)) {
        result.stderr.fill(0)
      }
    }
  }
}
