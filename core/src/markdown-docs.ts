// Markdown for the Docs tabs (T25, ISC-84): headings, tables, code blocks, mermaid fences as figures, TOC
// extraction. Pure, no Bun-only API: the web bundle may import it.
// Stub from the T1 seam: the fill-in task replaces the body and keeps the exported name and types.
import type { DocsPage } from './files.ts';

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- stub parameters; the fill-in uses them and drops this line
export function renderDocsMarkdown(_markdown: string): DocsPage {
  throw new Error('not implemented: renderDocsMarkdown');
}
