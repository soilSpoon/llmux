const VALID_CHARS = /^[a-zA-Z0-9_.\-:]$/
const INVALID_FIRST_CHAR = /^[0-9.\-:]$/
const MAX_LENGTH = 64

export function sanitizeToolName(name: string): string {
  let result = ''
  let prevWasReplacement = false

  for (const char of name) {
    if (VALID_CHARS.test(char)) {
      result += char
      prevWasReplacement = false
    } else if (char === ' ' || char === '/') {
      if (!prevWasReplacement && result.length > 0) {
        result += '_'
        prevWasReplacement = true
      }
    }
  }

  result = result.replace(/_+$/, '')

  if (result.length === 0) {
    return '_tool'
  }

  const firstChar = result[0]
  if (firstChar && INVALID_FIRST_CHAR.test(firstChar)) {
    result = `_${result}`
  }

  if (result.length > MAX_LENGTH) {
    result = result.slice(0, MAX_LENGTH)
  }

  return result
}
