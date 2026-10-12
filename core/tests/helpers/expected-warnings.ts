// Shared by fixtures.test.ts (golden snapshots) and planning.test.ts ("no milestone", spec 003 ISC-101.2): the
// dashboard diagnostics each fixture tree is pinned to, and the one formatting that renders them. One definition, so
// the two tests cannot drift apart.
import type { DashboardModel } from "../../src/dashboard.ts";

/** `file: code` for every diagnostic of the given severity in the model. */
export const diagnosticsOf = (m: DashboardModel, severity: "error" | "warning"): string[] =>
  m.diagnostics.filter((d) => d.diagnostic.severity === severity).map((d) => `${d.file}: ${d.diagnostic.code}`);

/**
 * The warnings each tree is expected to carry, as `file: code`; no tree may carry an error. Harbor's planted findings
 * (006's drift, the stale marks, 005's fog, 004's missing diagram) are dashboard warnings on the rows, not parse
 * diagnostics. Harbor's one warning is 005's planted `priority: high` (spec 008, T26), read from T39 on: it is none of
 * P1 to P4, so it warns `frontmatter-priority` and reads as P3. Lantern's one warning is 002's `events.jsonl`, which
 * keeps the legacy actor `principal` (spec 008, T33): read and flagged once for the file (`actor-legacy`, T60/T61).
 * Leadgen's: the frozen copy's own `ISA.md` declares `progress: 31/33` while the recount is 31/32. That is upstream text frozen at a named commit, not a parser fault, so it stays and is
 * pinned here.
 */
export const EXPECTED_WARNINGS: Record<string, string[]> = {
  harbor: ["specs/005-config-format-choice/spec.md: frontmatter-priority"],
  lantern: ["specs/002-duplicate-links/events.jsonl: actor-legacy"],
  "empty-master": [],
  "spectant-001": [],
  leadgen: ["ISA.md: master-progress-mismatch"],
};
