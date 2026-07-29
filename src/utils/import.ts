export const MAX_IMPORT_BYTES = 16 * 1024 * 1024
const ENVIRONMENT_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/

export type ImportedSecret = {
  key: string
  value: string
  environment?: string
  line: number
}

function decodeQuotedValue(
  source: string,
  quote: '"' | "'",
  line: number,
): string {
  let value = ''
  for (let index = 1; index < source.length; index += 1) {
    const character = source[index]
    if (character === quote) {
      const remainder = source.slice(index + 1).trim()
      if (remainder !== '' && !remainder.startsWith('#')) {
        throw new Error(`line ${line}: unexpected content after quoted value`)
      }
      return value
    }
    if (quote === "'" || character !== '\\') {
      value += character
      continue
    }
    index += 1
    if (index >= source.length) {
      throw new Error(`line ${line}: unterminated quoted value`)
    }
    const escaped = source[index]
    switch (escaped) {
      case 'n':
        value += '\n'
        break
      case 'r':
        value += '\r'
        break
      case '\\':
      case '"':
      case '$':
      case '`':
      case '!':
        value += escaped
        break
      default:
        value += `\\${escaped}`
    }
  }
  throw new Error(`line ${line}: unterminated quoted value`)
}

function statementEnd(lines: readonly string[], start: number): number {
  const separator = lines[start].indexOf('=')
  if (separator < 0) {
    return start + 1
  }
  const value = lines[start].slice(separator + 1).trimStart()
  if (!value.startsWith('"') && !value.startsWith("'")) {
    return start + 1
  }

  const quote = value[0]
  let escaped = false
  for (let lineIndex = start; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex]
    let position =
      lineIndex === start ? lines[start].length - value.length + 1 : 0
    for (; position < line.length; position += 1) {
      const character = line[position]
      if (quote === '"' && escaped) {
        escaped = false
        continue
      }
      if (quote === '"' && character === '\\') {
        escaped = true
        continue
      }
      if (character === quote) {
        return lineIndex + 1
      }
    }
    escaped = false
  }
  return lines.length
}

function parseAssignment(
  statement: string,
  line: number,
): { key: string; value: string } {
  const separator = statement.split('\n', 1)[0].indexOf('=')
  if (separator < 0) {
    throw new Error(`line ${line}: malformed dotenv assignment`)
  }
  let key = statement.slice(0, separator).trim()
  if (key.startsWith('export ')) {
    key = key.slice('export '.length).trim()
  }
  if (!ENVIRONMENT_KEY.test(key)) {
    throw new Error(`line ${line}: invalid environment key`)
  }

  const valueSource = statement.slice(separator + 1).trimStart()
  if (valueSource.startsWith('"')) {
    return {
      key,
      value: decodeQuotedValue(valueSource, '"', line),
    }
  }
  if (valueSource.startsWith("'")) {
    return {
      key,
      value: decodeQuotedValue(valueSource, "'", line),
    }
  }

  const comment = valueSource.search(/\s+#/)
  return {
    key,
    value: (comment < 0 ? valueSource : valueSource.slice(0, comment)).trim(),
  }
}

export function parseImport(contents: string): ImportedSecret[] {
  if (Buffer.byteLength(contents, 'utf8') > MAX_IMPORT_BYTES) {
    throw new Error(`import source exceeds ${MAX_IMPORT_BYTES} bytes`)
  }

  const lines = contents.replaceAll('\r\n', '\n').split('\n')
  const result: ImportedSecret[] = []
  let environment: string | undefined

  for (let index = 0; index < lines.length;) {
    const lineNumber = index + 1
    const trimmed = lines[index].trim()
    if (trimmed === '' || trimmed.startsWith('#') || trimmed.startsWith(';')) {
      index += 1
      continue
    }
    if (trimmed.startsWith('[')) {
      if (
        !trimmed.endsWith(']') ||
        [...trimmed].filter((character) => character === '[').length !== 1 ||
        [...trimmed].filter((character) => character === ']').length !== 1
      ) {
        throw new Error(`line ${lineNumber}: malformed environment section`)
      }
      const name = trimmed.slice(1, -1).trim()
      if (!name) {
        throw new Error(`line ${lineNumber}: environment section is empty`)
      }
      environment = name.toLowerCase() === 'default' ? undefined : name
      index += 1
      continue
    }

    const end = statementEnd(lines, index)
    const assignment = parseAssignment(
      lines.slice(index, end).join('\n'),
      lineNumber,
    )
    result.push({
      ...assignment,
      environment,
      line: lineNumber,
    })
    index = end
  }
  return result
}
