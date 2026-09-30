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
 * diagnostics, so harbor parses to zero diagnostics. The one warning is leadgen's: the frozen copy's own `ISA.md`
 * declares `progress: 31/33` while the recount is 31/32. That is upstream text frozen at a named commit, not a parser
 * fault, so it stays and is pinned here.
 */
export const EXPECTED_WARNINGS: Record<string, string[]> = {
  harbor: [],
  lantern: [],
  "empty-master": [],
  "spectant-001": [],
  leadgen: ["ISA.md: master-progress-mismatch"],
};
