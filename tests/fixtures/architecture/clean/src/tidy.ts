// Fixture for the architecture guard (spec 059, ISC-415): a root no rule flags.
export function tidy(words: string[]): string {
  return words
    .map((word) => word.trim())
    .filter((word) => word !== "")
    .join(" ");
}
