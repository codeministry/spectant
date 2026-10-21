// Fixture for the duplicates rule (spec 059, ISC-414): the body of `summarise` is copied into nested/copy.ts.
export type Entry = { name: string; size: number; tags: string[] };

export function summarise(entries: Entry[]): string {
  const totals = new Map<string, number>();
  for (const entry of entries) {
    for (const tag of entry.tags) {
      const previous = totals.get(tag) ?? 0;
      totals.set(tag, previous + entry.size);
    }
  }
  const lines: string[] = [];
  for (const [tag, total] of [...totals.entries()].sort((a, b) => b[1] - a[1])) {
    lines.push(`${tag.padEnd(12, " ")} ${String(total).padStart(8, " ")}`);
  }
  return lines.join("\n");
}
