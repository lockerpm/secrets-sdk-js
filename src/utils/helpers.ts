export function camelToSnake(obj: { [key: string]: any }) {
  if (typeof obj !== 'object' || obj === null) {
    return obj
  }
  const snakeCaseObject: { [key: string]: any } = {}
  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      const snakeKey = key.replace(
        /[A-Z]/g,
        (match) => `_${match.toLowerCase()}`
      )
      snakeCaseObject[snakeKey] = camelToSnake(obj[key])
    }
  }
  return snakeCaseObject
}
