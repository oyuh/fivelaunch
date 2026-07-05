/**
 * FNV-1a 32-bit hash, returned as an 8-char lowercase hex string.
 *
 * Used for stable IDs for discovered files/paths.
 */
export function fnv1a32Hex(input: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = (hash * 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}
