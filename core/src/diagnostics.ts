// Parse diagnostics shared by the parsers in core/. A parser never throws on malformed input: it reads what it can
// and reports the rest here, so one broken file shows up as a warning on the dashboard instead of an empty page.
// Types only, no runtime code: the browser bundle may import it.

export type DiagnosticSeverity = 'error' | 'warning';

export interface Diagnostic {
  readonly severity: DiagnosticSeverity;
  /** Stable, kebab-case, prefixed by the parser: `frontmatter-unclosed`, `claim-no-id`. Tests and the UI key on it. */
  readonly code: string;
  /** One sentence for a human. */
  readonly message: string;
  /** 1-based line in the parsed text, when the finding has one. */
  readonly line?: number;
}
