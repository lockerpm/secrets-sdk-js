export const MAX_JSON_DEPTH = 256

function syntaxFailure(message: string): never {
  throw new SyntaxError(message)
}

function assertUnicodeScalarString(value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index)
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (!Number.isInteger(next) || next < 0xdc00 || next > 0xdfff) {
        syntaxFailure('JSON string contains an unpaired Unicode surrogate')
      }
      index += 1
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      syntaxFailure('JSON string contains an unpaired Unicode surrogate')
    }
  }
}

/**
 * Parse exactly one JSON value, rejecting duplicate object fields and
 * excessive nesting. Native JSON.parse silently keeps the last duplicate,
 * which is not acceptable at the SDK protocol boundary.
 */
export function parseStrictJSON(
  input: string,
  maxDepth = MAX_JSON_DEPTH,
): unknown {
  if (!Number.isSafeInteger(maxDepth) || maxDepth < 0) {
    throw new RangeError('maxDepth must be a non-negative safe integer')
  }

  let offset = 0
  const skipWhitespace = () => {
    while (
      offset < input.length &&
      (input[offset] === ' ' ||
        input[offset] === '\t' ||
        input[offset] === '\r' ||
        input[offset] === '\n')
    ) {
      offset += 1
    }
  }

  const parseString = (): string => {
    if (input[offset] !== '"') {
      return syntaxFailure('JSON object keys must be strings')
    }
    const start = offset
    offset += 1
    while (offset < input.length) {
      const character = input.charCodeAt(offset)
      if (character === 0x22) {
        offset += 1
        const value = JSON.parse(input.slice(start, offset)) as string
        assertUnicodeScalarString(value)
        return value
      }
      if (character < 0x20) {
        return syntaxFailure('JSON strings contain a control character')
      }
      if (character === 0x5c) {
        offset += 1
        const escape = input[offset]
        if (escape === undefined || !'"\\/bfnrtu'.includes(escape)) {
          return syntaxFailure('JSON strings contain an invalid escape')
        }
        if (escape === 'u') {
          const codepoint = input.slice(offset + 1, offset + 5)
          if (!/^[0-9A-Fa-f]{4}$/.test(codepoint)) {
            return syntaxFailure('JSON strings contain an invalid escape')
          }
          offset += 4
        }
      }
      offset += 1
    }
    return syntaxFailure('JSON string is unterminated')
  }

  const parseValue = (depth: number): void => {
    if (depth > maxDepth) {
      return syntaxFailure(`JSON nesting exceeds ${maxDepth} levels`)
    }
    skipWhitespace()
    const character = input[offset]
    if (character === '{') {
      offset += 1
      skipWhitespace()
      const fields = new Set<string>()
      if (input[offset] === '}') {
        offset += 1
        return
      }
      while (true) {
        const field = parseString()
        if (fields.has(field)) {
          return syntaxFailure('JSON object contains a duplicate field')
        }
        fields.add(field)
        skipWhitespace()
        if (input[offset] !== ':') {
          return syntaxFailure('JSON object field is missing a colon')
        }
        offset += 1
        parseValue(depth + 1)
        skipWhitespace()
        if (input[offset] === '}') {
          offset += 1
          return
        }
        if (input[offset] !== ',') {
          return syntaxFailure('JSON object is missing a comma')
        }
        offset += 1
        skipWhitespace()
      }
    }
    if (character === '[') {
      offset += 1
      skipWhitespace()
      if (input[offset] === ']') {
        offset += 1
        return
      }
      while (true) {
        parseValue(depth + 1)
        skipWhitespace()
        if (input[offset] === ']') {
          offset += 1
          return
        }
        if (input[offset] !== ',') {
          return syntaxFailure('JSON array is missing a comma')
        }
        offset += 1
      }
    }
    if (character === '"') {
      parseString()
      return
    }
    for (const literal of ['true', 'false', 'null']) {
      if (input.startsWith(literal, offset)) {
        offset += literal.length
        return
      }
    }
    const number = input
      .slice(offset)
      .match(/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/)
    if (!number) {
      return syntaxFailure('JSON contains an invalid value')
    }
    offset += number[0].length
  }

  skipWhitespace()
  parseValue(0)
  skipWhitespace()
  if (offset !== input.length) {
    syntaxFailure('JSON must contain exactly one value')
  }
  return JSON.parse(input) as unknown
}

export function assertJSONDepth(
  value: unknown,
  maxDepth = MAX_JSON_DEPTH,
): void {
  const ancestors = new Set<object>()
  const visit = (current: unknown, depth: number): void => {
    if (depth > maxDepth) {
      throw new RangeError(`JSON nesting exceeds ${maxDepth} levels`)
    }
    if (typeof current === 'string') {
      assertUnicodeScalarString(current)
      return
    }
    if (typeof current === 'number') {
      if (!Number.isFinite(current)) {
        throw new TypeError('JSON value contains a non-finite number')
      }
      return
    }
    if (current === null || typeof current === 'boolean') {
      return
    }
    if (typeof current !== 'object') {
      throw new TypeError(`${typeof current} is not a JSON value`)
    }
    if (ancestors.has(current)) {
      throw new TypeError('JSON value contains a cycle')
    }
    const prototype = Object.getPrototypeOf(current)
    if (
      !Array.isArray(current) &&
      prototype !== Object.prototype &&
      prototype !== null
    ) {
      throw new TypeError('JSON value contains a non-plain object')
    }
    ancestors.add(current)
    if (Array.isArray(current)) {
      for (const item of current) {
        visit(item, depth + 1)
      }
    } else {
      for (const [key, item] of Object.entries(
        current as Record<string, unknown>,
      )) {
        assertUnicodeScalarString(key)
        visit(item, depth + 1)
      }
    }
    ancestors.delete(current)
  }
  visit(value, 0)
}
