// Markdown for the Docs tabs (T25, ISC-84): the document layer over the one renderer in `markdown.ts`. It splits the
// frontmatter off (`frontmatter.ts`), renders the body in document mode (mermaid fences and standalone images as
// numbered figures), keeps h2/h3 for the table of contents and every heading as a section, and counts the prose.
// Pure and deterministic, no Bun or Node API: the web bundle may import it.
//
// Mermaid is not rendered here. Each fence becomes `<figure data-figure="n"><pre class="mermaid">…</pre>`, its source
// escaped, and the web app draws it client-side with the pinned mermaid package.
import type { DocAvailability, DocName, DocsPage, SpecType } from './files.ts';
import { parseFrontmatter } from './frontmatter.ts';
import { renderMarkdown } from './markdown.ts';
import { TYPE_NEEDS } from './stage.ts';

export interface DocsOptions {
  /** Prefix for every heading id, so two documents on one page never collide. */
  readonly idPrefix?: string;
  /**
   * Whether a relative image path (as written, relative to the document's folder) exists. The caller answers from a
   * directory listing; the file is never read. Absent: existence is unknown and no figure is flagged missing.
   */
  readonly assetExists?: (src: string) => boolean;
}

const ENTITIES: Readonly<Record<string, string>> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };

/** Words of prose in rendered HTML: figures and code blocks dropped, tags stripped, entities decoded. */
function countWords(html: string): number {
  const text = html
    .replace(/<figure\b[\s\S]*?<\/figure>/g, ' ')
    .replace(/<pre\b[\s\S]*?<\/pre>/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(?:amp|lt|gt|quot|#39);/g, (e) => ENTITIES[e] ?? ' ');
  return text.match(/[\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+)*/gu)?.length ?? 0;
}

/** One Docs tab page from the text of plan.md, design.md, context.md or the constitution. */
export function renderDocsMarkdown(markdown: string, options?: DocsOptions): DocsPage {
  const fm = parseFrontmatter(markdown);
  const rendered = renderMarkdown(fm.body, {
    document: true,
    ...(options?.idPrefix === undefined ? {} : { idPrefix: options.idPrefix }),
    ...(options?.assetExists === undefined ? {} : { assetExists: options.assetExists }),
  });
  return {
    frontmatter: fm.present ? { ...fm.values } : null,
    html: rendered.html,
    toc: rendered.toc.filter((entry) => entry.level === 2 || entry.level === 3),
    figures: rendered.figures,
    sections: rendered.toc.map((entry) => ({ id: entry.anchor, heading: entry.text, level: entry.level })),
    wordCount: countWords(rendered.html),
  };
}

/** Spec types whose workflow has a design pass: the ones that build a surface. */
const DESIGN_TYPES: ReadonlySet<SpecType> = new Set(['feature', 'project']);

/**
 * Which Docs tabs a spec type has, for the type-aware empty state: a tab whose file is absent either belongs to the
 * type (not written yet: offer the command) or does not (say why). The plan follows `TYPE_NEEDS`; an unknown type
 * needs none. The context log and the constitution belong to every type; no one command writes the context log.
 */
export function docsFor(type: SpecType | null): Readonly<Record<DocName, DocAvailability>> {
  return {
    plan: { applies: type === null ? false : TYPE_NEEDS[type].plan, command: '/spec-plan' },
    design: { applies: type !== null && DESIGN_TYPES.has(type), command: '/spec-design' },
    decisions: { applies: true, command: null },
    constitution: { applies: true, command: '/spec-bootstrap' },
  };
}
