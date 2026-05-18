// Vitest shim for `next/headers`. In tests there is no Next.js request context,
// so headers() / cookies() would throw. Return empty read-only maps instead.
const emptyHeaders = {
  get: () => null,
  has: () => false,
  getAll: () => [],
  keys: () => [][Symbol.iterator](),
  values: () => [][Symbol.iterator](),
  entries: () => [][Symbol.iterator](),
  forEach: () => {},
  [Symbol.iterator]: () => [][Symbol.iterator](),
  append: () => {},
  delete: () => {},
  set: () => {},
}
export const headers = () => Promise.resolve(emptyHeaders)
export const cookies = () => Promise.resolve(emptyHeaders)
