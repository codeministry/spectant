// The markdown renderer for the Brief (T38, ISC-16), ported from the old SpecMarkdown: headings, fences, tables,
// nested lists with checkboxes, blockquotes, rules, inline code, bold, italic, strike and links; every string escaped,
// raw HTML never passed through, HTML comments dropped. No Bun API and no Node API: the web app imports it.
// Stub from the T33 seam: the fill-in task replaces the body and keeps the exported name and types.
import type { DocsPage } from './files.ts';

export interface MarkdownOptions {
  /** Prefix for heading anchors, so several documents on one page never collide. */
  readonly idPrefix?: string;
}

/** The rendered HTML plus its table of contents (the same shape as the Docs area's pages). */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- stub parameters; the fill-in uses them and drops this line
export function renderMarkdown(_markdown: string, _options?: MarkdownOptions): DocsPage {
  throw new Error('not implemented: renderMarkdown');
}
