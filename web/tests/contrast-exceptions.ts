// The one exception list for ISC-65 as refined by ISC-146.1 (spec 024): the colour pairs that stay below the WCAG 2.x
// line because the prototype's value wins over a contrast correction ("Prototyp gilt immer"). Each entry is a token
// pair measured on its surface in one theme; `specs/constitution.md` § Adaptations (DS-APP-32/33) names the same
// pairs with the same ratios.
//
// Two guards read it, so the list lives in one place:
// - `web/tests/tokens.test.ts` recomputes every pair from the CSS and requires the set of pairs below the line to
//   equal this list exactly: a pair below the line that is missing here fails, and an entry whose pair now passes
//   (or whose ratio, `fg` or `bg` drifted) fails too.
// - `web/e2e/browser/contrast.spec.ts` accepts a rendered failure only when its painted colours match an entry of
//   its theme (`fg` on `bg`, each channel within 1 of the 8-bit paint).
//
// Pure data: no file access, so the Playwright runner can import it as well as Bun.

export type ContrastException = {
  /** The token painted as text or mark. */
  readonly tone: `--${string}`;
  readonly theme: "spec-light" | "spec-dark";
  /** The surface token under it. */
  readonly surface: `--${string}`;
  /** The 8-bit paint of `tone` and of `surface`, as `#rrggbb`. */
  readonly fg: string;
  readonly bg: string;
  /** Measured WCAG 2.x ratio, worst of the exact and the 8-bit paint, to two decimals. */
  readonly ratio: number;
  /** The line it misses: 4.5 for text, 3 for marks. */
  readonly min: number;
};

// Light accent text on its own tint (chips, the id chip, the danger and warning buttons, notices). On the card and
// the page every prototype `--*-text` clears 4.5:1; on its tint none does, and the prototype keeps it.
export const CONTRAST_EXCEPTIONS: readonly ContrastException[] = [
  { tone: "--disp-ink", theme: "spec-light", surface: "--disp-t", fg: "#027892", bg: "#ddf0f4", ratio: 4.34, min: 4.5 },
  { tone: "--ques-ink", theme: "spec-light", surface: "--ques-t", fg: "#7058be", bg: "#ebe5f8", ratio: 4.46, min: 4.5 },
  { tone: "--clos-ink", theme: "spec-light", surface: "--clos-t", fg: "#417c02", bg: "#e3f0d6", ratio: 4.31, min: 4.5 },
  { tone: "--done-ink", theme: "spec-light", surface: "--done-t", fg: "#007e50", bg: "#ddf3e8", ratio: 4.4, min: 4.5 },
  { tone: "--conc-ink", theme: "spec-light", surface: "--conc-t", fg: "#a15e01", bg: "#fbedd4", ratio: 4.41, min: 4.5 },
  { tone: "--hover-ink", theme: "spec-light", surface: "--hover-t", fg: "#ad560c", bg: "#fbedd4", ratio: 4.41, min: 4.5 },
  { tone: "--fail-ink", theme: "spec-light", surface: "--fail-t", fg: "#ca3063", bg: "#fbe3ea", ratio: 4.19, min: 4.5 },
];
