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
  /** A mark painted at this coverage over `surface` (the meter and ring track at 45 %); `fg` is the composited paint. */
  readonly alpha?: number;
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
  // The neutral chip (the prototype's base chip): `--muted` text on `--raised` (daisyUI's `--color-base-300`), both themes.
  { tone: "--muted-ink", theme: "spec-light", surface: "--color-base-300", fg: "#706b6e", bg: "#ede7e5", ratio: 4.27, min: 4.5 },
  { tone: "--muted-ink", theme: "spec-dark", surface: "--color-base-300", fg: "#939293", bg: "#403e41", ratio: 3.41, min: 4.5 },
  // spec 024: prototype background (principal 2026-10-13). The light primary button is the prototype `.btn.primary`:
  // `--cyan` under `--page`.
  { tone: "--primary-fill-ink", theme: "spec-light", surface: "--primary-fill", fg: "#f6f1ef", bg: "#1c8ca8", ratio: 3.49, min: 4.5 },
  // spec 024: prototype background (principal 2026-10-13). The meter and ring track is the prototype's `--track` at
  // 45 % (`color-mix(… 45%, transparent)`, opacity .45), on the card and the page of both themes.
  { tone: "--track", theme: "spec-light", surface: "--color-base-100", fg: "#c9c5c7", bg: "#fdfaf9", ratio: 1.64, min: 3, alpha: 0.45 },
  { tone: "--track", theme: "spec-light", surface: "--color-base-200", fg: "#c5c0c1", bg: "#f6f1ef", ratio: 1.6, min: 3, alpha: 0.45 },
  { tone: "--track", theme: "spec-dark", surface: "--color-base-100", fg: "#524f53", bg: "#2d2a2e", ratio: 1.76, min: 3, alpha: 0.45 },
  { tone: "--track", theme: "spec-dark", surface: "--color-base-200", fg: "#4c494c", bg: "#221f22", ratio: 1.84, min: 3, alpha: 0.45 },
  // spec 024: prototype background (principal 2026-10-13). The pending stage-track segment is the prototype's `--track`
  // at 55 %, on the card and the page of both themes.
  { tone: "--track", theme: "spec-light", surface: "--color-base-100", fg: "#beb9bb", bg: "#fdfaf9", ratio: 1.86, min: 3, alpha: 0.55 },
  { tone: "--track", theme: "spec-light", surface: "--color-base-200", fg: "#bbb5b7", bg: "#f6f1ef", ratio: 1.8, min: 3, alpha: 0.55 },
  { tone: "--track", theme: "spec-dark", surface: "--color-base-100", fg: "#5a585b", bg: "#2d2a2e", ratio: 2, min: 3, alpha: 0.55 },
  { tone: "--track", theme: "spec-dark", surface: "--color-base-200", fg: "#555356", bg: "#221f22", ratio: 2.13, min: 3, alpha: 0.55 },
];
