/**
 * @returns New array with all falsy values removed. The original array IS NOT modified.
 */
export function coalesce<T>(array: ReadonlyArray<T | undefined | null>): T[] {
  return <T[]>array.filter((e) => !!e);
}

export function mapArrayOrNot<T, U>(items: T | T[], fn: (_: T) => U): U | U[] {
  return Array.isArray(items) ? items.map(fn) : fn(items);
}
