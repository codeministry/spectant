/**
 * The strong ETag every exact-bytes answer shares: sha256 over the parts in order, base64url, quoted. A JSON answer
 * hashes its body (`json.ts`), the timeline its body, a NUL and `HEAD` (`timelineEtag`), a workspace image its bytes.
 */
export function strongEtag(...parts: ReadonlyArray<string | Uint8Array>): string {
  const hasher = new Bun.CryptoHasher("sha256");
  for (const part of parts) hasher.update(part);
  return `"${hasher.digest("base64url")}"`;
}
