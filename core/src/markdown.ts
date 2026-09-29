// The one markdown renderer of the app (spec 001 T38, ISC-16; spec 002 T25, ISC-84), ported from the old
// SpecMarkdown: headings, fences, tables, nested lists with checkboxes, blockquotes, rules, hard breaks, inline code,
// bold, italic, strike, links and `⟨?: …⟩` open marks; every string escaped, raw HTML never passed through, HTML
// comments dropped. No Bun API and no Node API: the web app imports it.
//
// Two callers, one renderer. The Brief renders with the defaults. The Docs tabs (`markdown-docs.ts`) render in
// document mode: a mermaid fence becomes a numbered `<figure>` holding its escaped source for the web app to draw
// client-side, a paragraph that is a single image becomes a numbered figure (the file is never read; the caller only
// says whether it exists), and task boxes are disabled checkboxes. A second renderer would be the same smell as a
// second parser.
//
// Not CommonMark and not trying to be: the spec format bounds what these files hold, and anything outside that shape
// falls through as an escaped paragraph. Differences from the old renderer, all narrowing: an image outside document
// mode, or inside running text, is not rendered (its alt text stands in), no copy button and no bilingual callout
// title (the web app owns every visible label), and the private-use character U+E000 that brackets a code-span
// placeholder is dropped from the input, so text can never forge one.
import type { DocsFigure, RenderedMarkdown, TocEntry } from './files.ts';

export interface MarkdownOptions {
  /** Prefix for heading anchors, so several documents on one page never collide. */
  readonly idPrefix?: string;
  /** Document mode, for the Docs tabs: mermaid fences and standalone images become numbered figures. */
  readonly document?: boolean;
  /**
   * Document mode: whether the relative image path `src` (as written, relative to the document's folder) exists.
   * Asked once per image and never used to read the file. Absent: existence is unknown and no figure is flagged.
   */
  readonly assetExists?: (src: string) => boolean;
}

const ESCAPES: Readonly<Record<string, string>> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);
}

function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/`/g, '')
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'h'
  );
}

/**
 * Link targets that may render: the web, mail, an in-page anchor, a markdown file, or any other relative path (no
 * scheme and no leading `/`, so never `javascript:` or `data:`).
 */
const SAFE_HREF = /^(?:https?:|mailto:|#|[\w./-]+\.md(?:#[\w-]*)?$|[\w.~%+-]+(?:\/[\w.~%+-]+)*\/?(?:#[\w.-]*)?$)/;
/** An image source that may load: a relative path only, so the page never fetches from off the machine. */
const LOCAL_SRC = /^[\w.~%+-]+(?:\/[\w.~%+-]+)*$/;
const REMOTE_SRC = /^https?:\/\/[^\s"'<>]+$/i;
/** A link or image target: no whitespace, one level of balanced parentheses (`javascript:alert(1)` is one target). */
const TARGET = String.raw`((?:[^()\s]|\([^()\s]*\))+)`;
const IMAGE_INLINE = new RegExp(String.raw`!\[([^\]\n]*)\]\(${TARGET}\)`, 'g');
const LINK_INLINE = new RegExp(String.raw`\[([^\]\n]+)\]\(${TARGET}\)`, 'g');
/** A paragraph that is one image and nothing else. */
const IMAGE_LINE = new RegExp(String.raw`^!\[([^\]\n]*)\]\(${TARGET}\)$`);
/** An open question of the spec format, `⟨?: …⟩`, matched on escaped text. */
const OPEN_MARK = /⟨\?:[^⟩\n]*⟩/g;
const PLACEHOLDER = /\uE000(\d+)\uE000/g;

/**
 * Inline markup. Code spans are lifted out first so nothing inside them is touched, then the rest is escaped and
 * links, bare web addresses, bold, italic and strike are applied to the escaped text. `_` italics only when bounded
 * by whitespace, so identifiers like `principal_stated_goal` outside a code span stay plain.
 */
function renderInline(text: string): string {
  const codes: string[] = [];
  let s = text.replace(/`([^`\n]+)`/g, (_, code: string) => {
    codes.push(`<code>${esc(code)}</code>`);
    return `\uE000${codes.length - 1}\uE000`;
  });
  s = esc(s);
  // An image is not rendered: its alt text stands in. Before links, so `![a](b)` is never read as `!` + a link.
  s = s.replace(IMAGE_INLINE, (_, alt: string) => alt);
  s = s.replace(LINK_INLINE, (_, label: string, href: string) => {
    const raw = href.replace(/&amp;/g, '&');
    if (!SAFE_HREF.test(raw)) return label;
    // A web page always opens beside the dashboard, never in its place.
    return `<a href="${esc(raw)}"${/^https?:/i.test(raw) ? ' target="_blank" rel="noopener"' : ''}>${label}</a>`;
  });
  // A bare web address links itself: only in text between tags, and without the punctuation that ends its sentence.
  s = s
    .split(/(<a\b[^>]*>[\s\S]*?<\/a>|<[^>]+>)/)
    .map((part, k) =>
      k % 2 === 1
        ? part
        : part.replace(/\bhttps?:\/\/[^\s<>"'\uE000]+/g, (u) => {
            const m = /^(.*?)([.,;:!?)\]]*)$/.exec(u);
            let url = m?.[1] ?? u;
            let tail = m?.[2] ?? '';
            // A closing parenthesis belongs to the address when the address opened one (Wikipedia-style paths).
            while (tail.startsWith(')') && (url.match(/\(/g) ?? []).length > (url.match(/\)/g) ?? []).length) {
              url += ')';
              tail = tail.slice(1);
            }
            return `<a href="${url}" target="_blank" rel="noopener">${url}</a>${tail}`;
          }),
    )
    .join('');
  // A single `*` may sit inside strong text (`**FE-FW-*, DS-APP-*:**`, wildcard rule IDs); a double one closes it.
  s = s.replace(/\*\*((?:[^*\n]|\*(?!\*))+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>');
  s = s.replace(/(^|\s)_([^_\n]+)_(?=[\s.,;:!?)]|$)/g, '$1<em>$2</em>');
  s = s.replace(/~~([^~\n]+)~~/g, '<s>$1</s>');
  s = s.replace(OPEN_MARK, (m) => `<mark class="open-mark">${m}</mark>`);
  return s.replace(PLACEHOLDER, (_, i: string) => codes[Number(i)] ?? '');
}

const FENCE = /^\s*(```|~~~)\s*(\S*)\s*$/;
const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;
const ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const CHECK = /^\[([ xX])\]\s+(.*)$/;
const QUOTE = /^\s*>/;
const TABLE_ROW = /^\s*\|/;
/** GFM: one hyphen per cell is enough. */
const TABLE_SEP = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
/** A cell that holds a figure: right-aligned by the stylesheet unless its column says otherwise. */
const NUMERIC = /^[-+\u2212]?\d[\d.,\u202f ]*\s*(%|‰|€|\$|ms|s|min|h|[KMG]B|px)?$/;
const CALLOUT = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*$/i;

interface Item {
  readonly depth: number;
  readonly ordered: boolean;
  readonly text: string;
  readonly checked: boolean | null;
}

const blank = (line: string | undefined): boolean => line === undefined || line.trim() === '';
const indentOf = (line: string): number => line.replace(/\t/g, '  ').search(/\S/);

function tableCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split(/(?<!\\)\|/)
    .map((c) => c.trim().replace(/\\\|/g, '|'));
}

function renderList(items: readonly Item[], document: boolean): string {
  let k = 0;
  const walk = (depth: number): string => {
    const ordered = items[k]?.ordered ?? false;
    const parts: string[] = [];
    for (let it = items[k]; it !== undefined && it.depth >= depth; it = items[k]) {
      if (it.depth > depth) {
        parts.push(walk(it.depth));
        continue;
      }
      // `- a` followed by `1. b` at the same depth: two lists, not one.
      if (it.ordered !== ordered) break;
      k += 1;
      const cb =
        it.checked === null
          ? ''
          : document
            ? `<input type="checkbox"${it.checked ? ' checked' : ''} disabled> `
            : `<span class="cb ${it.checked ? 'on' : 'off'}" aria-label="${it.checked ? 'done' : 'open'}">${it.checked ? '●' : '○'}</span> `;
      const next = items[k];
      const children = next !== undefined && next.depth > depth ? walk(next.depth) : '';
      const cls = it.checked === null ? '' : ` class="task ${it.checked ? 'done' : 'open'}"`;
      parts.push(`<li${cls}>${cb}${renderInline(it.text)}${children}</li>`);
    }
    return `<${ordered ? 'ol' : 'ul'}>${parts.join('')}</${ordered ? 'ol' : 'ul'}>`;
  };
  const lists: string[] = [];
  for (let first = items[k]; first !== undefined; first = items[k]) lists.push(walk(first.depth));
  return lists.join('\n');
}

interface Context {
  readonly prefix: string;
  readonly ids: Map<string, number>;
  readonly toc: TocEntry[];
  readonly document: boolean;
  readonly assetExists: ((src: string) => boolean) | undefined;
  readonly figures: DocsFigure[];
  /** The plain text of the last heading seen, the fallback caption of a mermaid figure. */
  heading: string | null;
}

/** The diagram keyword and the `title:` of a mermaid source (from its own `---` block); `%%` comments skipped. */
function mermaidHead(source: string): { diagram: string; title: string | null } {
  const lines = source.split('\n');
  let k = 0;
  let title: string | null = null;
  while (k < lines.length && (lines[k] ?? '').trim() === '') k += 1;
  if ((lines[k] ?? '').trim() === '---') {
    for (k += 1; k < lines.length && (lines[k] ?? '').trim() !== '---'; k += 1) {
      const t = /^\s*title:\s*(.+?)\s*$/.exec(lines[k] ?? '');
      if (t) title = (t[1] ?? '').replace(/^(["'])(.*)\1$/, '$2');
    }
    k += 1;
  }
  const first = lines.slice(k).find((l) => l.trim() !== '' && !l.trim().startsWith('%%')) ?? '';
  return { diagram: first.trim().split(/\s+/)[0] ?? '', title };
}

/** A mermaid fence as a numbered figure: the source escaped inside `pre.mermaid`, drawn by the web app, not here. */
function mermaidFigure(source: string, ctx: Context): string {
  const index = ctx.figures.length + 1;
  const { diagram, title } = mermaidHead(source);
  const caption = title ?? ctx.heading ?? diagram;
  ctx.figures.push({ index, kind: 'mermaid', diagram, source, caption });
  return `<figure class="mermaid-figure" data-figure="${index}"><pre class="mermaid">${esc(source)}</pre><figcaption>${esc(caption)}</figcaption></figure>`;
}

/** A standalone image as a numbered figure; null when its source may neither load nor link (`javascript:`, `data:`). */
function imageFigure(alt: string, src: string, ctx: Context): string | null {
  const remote = REMOTE_SRC.test(src);
  if (!remote && !LOCAL_SRC.test(src)) return null;
  const index = ctx.figures.length + 1;
  const caption = alt || (src.split('/').pop() ?? src);
  const cap = `<figcaption>${esc(caption)}</figcaption>`;
  if (remote) {
    // Never an <img>: the page would fetch from off the machine. A link the reader chooses to follow.
    ctx.figures.push({ index, kind: 'image', src, alt, caption, remote: true });
    return `<figure class="image-figure remote" data-figure="${index}" data-remote><a href="${esc(src)}" target="_blank" rel="noopener">${esc(src)}</a>${cap}</figure>`;
  }
  if (ctx.assetExists?.(src) === false) {
    ctx.figures.push({ index, kind: 'image', src, alt, caption, missing: true });
    return `<figure class="image-figure missing" data-figure="${index}" data-missing><div class="figure-missing" role="img" aria-label="${esc(caption)}"><code>${esc(src)}</code></div>${cap}</figure>`;
  }
  ctx.figures.push({ index, kind: 'image', src, alt, caption });
  return `<figure class="image-figure" data-figure="${index}"><img src="${esc(src)}" alt="${esc(alt)}" loading="lazy">${cap}</figure>`;
}

/** A paragraph's lines: soft breaks join with a space; two trailing spaces or a trailing backslash break the line. */
function renderParagraph(lines: readonly string[]): string {
  const segments: string[][] = [[]];
  lines.forEach((raw, k) => {
    const hard = k < lines.length - 1 && / {2,}$|\\$/.test(raw);
    const text = raw.trim();
    segments[segments.length - 1]?.push(hard ? text.replace(/\\$/, '').trimEnd() : text);
    if (hard) segments.push([]);
  });
  return segments.map((segment) => renderInline(segment.join(' '))).join('<br>');
}

function renderBlocks(md: string, ctx: Context): string {
  const lines = md.split('\n');
  const out: string[] = [];
  const at = (n: number): string => lines[n] ?? '';
  let i = 0;

  const uniqueId = (text: string): string => {
    const base = ctx.prefix + slugify(text);
    const n = (ctx.ids.get(base) ?? 0) + 1;
    ctx.ids.set(base, n);
    return n === 1 ? base : `${base}-${n}`;
  };
  const isTable = (n: number): boolean => TABLE_ROW.test(at(n)) && n + 1 < lines.length && TABLE_SEP.test(at(n + 1));

  while (i < lines.length) {
    const line = at(i);
    if (blank(line)) {
      i += 1;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence) {
      const close = new RegExp(String.raw`^\s*${fence[1] ?? '```'}\s*$`);
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !close.test(at(i))) body.push(at(i++));
      i += 1;
      const lang = fence[2] ?? '';
      if (ctx.document && lang === 'mermaid') {
        out.push(mermaidFigure(body.join('\n'), ctx));
        continue;
      }
      // Outside document mode a mermaid fence stays a bare fence: the web app finds it by its class and draws it.
      out.push(`<pre><code${lang ? ` class="lang-${esc(lang)}"` : ''}>${esc(body.join('\n'))}</code></pre>`);
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      const level = (heading[1] ?? '#').length;
      const text = heading[2] ?? '';
      const anchor = uniqueId(text);
      ctx.heading = text.replace(/`/g, '');
      ctx.toc.push({ level, text: ctx.heading, anchor });
      out.push(`<h${level} id="${esc(anchor)}">${renderInline(text)}</h${level}>`);
      i += 1;
      continue;
    }

    if (RULE.test(line)) {
      out.push('<hr>');
      i += 1;
      continue;
    }

    if (QUOTE.test(line)) {
      const body: string[] = [];
      while (i < lines.length && QUOTE.test(at(i))) body.push(at(i++).replace(/^\s*>\s?/, ''));
      const kind = CALLOUT.exec(body[0] ?? '')?.[1]?.toLowerCase();
      out.push(
        kind
          ? `<blockquote class="callout" data-kind="${kind}">${renderBlocks(body.slice(1).join('\n'), ctx)}</blockquote>`
          : `<blockquote>${renderBlocks(body.join('\n'), ctx)}</blockquote>`,
      );
      continue;
    }

    if (isTable(i)) {
      const head = tableCells(line);
      const align = tableCells(at(i + 1)).map((c) =>
        /^:-+:$/.test(c) ? 'center' : c.endsWith('-:') ? 'right' : c.startsWith(':-') ? 'left' : '',
      );
      const style = (k: number) => (align[k] ? ` style="text-align:${align[k]}"` : '');
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && TABLE_ROW.test(at(i))) rows.push(tableCells(at(i++)));
      const thead = head.map((c, k) => `<th${style(k)}>${renderInline(c)}</th>`).join('');
      const tbody = rows
        .map((r) => `<tr>${head.map((_, k) => `<td${style(k)}${NUMERIC.test(r[k] ?? '') ? ' data-num' : ''}>${renderInline(r[k] ?? '')}</td>`).join('')}</tr>`)
        .join('');
      out.push(`<div class="mdtable"><table><thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody></table></div>`);
      continue;
    }

    if (ITEM.test(line)) {
      // The whole list: items plus their continuation lines (indented deeper than the marker, as wrapped task rows
      // are), ending at a blank line not followed by another item.
      const items: Item[] = [];
      while (i < lines.length) {
        const m = ITEM.exec(at(i));
        if (!m) {
          if (blank(at(i)) && ITEM.test(at(i + 1))) {
            i += 1;
            continue;
          }
          break;
        }
        const depth = (m[1] ?? '').replace(/\t/g, '  ').length;
        let text = m[3] ?? '';
        i += 1;
        while (i < lines.length && !blank(at(i)) && !ITEM.test(at(i)) && !HEADING.test(at(i)) && !FENCE.test(at(i)) && indentOf(at(i)) > depth) {
          text += ` ${at(i++).trim()}`;
        }
        const c = CHECK.exec(text);
        items.push({ depth, ordered: /\d/.test(m[2] ?? ''), text: c ? (c[2] ?? '') : text, checked: c ? c[1] !== ' ' : null });
      }
      out.push(renderList(items, ctx.document));
      continue;
    }

    const para: string[] = [];
    while (i < lines.length && !blank(at(i)) && !HEADING.test(at(i)) && !FENCE.test(at(i)) && !ITEM.test(at(i)) && !QUOTE.test(at(i)) && !isTable(i)) {
      para.push(at(i++));
    }
    if (para.length === 0) {
      i += 1;
      continue;
    }
    const image = ctx.document && para.length === 1 ? IMAGE_LINE.exec((para[0] ?? '').trim()) : null;
    const figure = image ? imageFigure(image[1] ?? '', image[2] ?? '', ctx) : null;
    out.push(figure ?? `<p>${renderParagraph(para)}</p>`);
  }
  return out.join('\n');
}

/** The rendered HTML, every heading, and in document mode the numbered figures. */
export function renderMarkdown(markdown: string, options?: MarkdownOptions): RenderedMarkdown {
  // HTML comments are authoring notes (`<!-- section: overview -->`); they never render.
  const md = markdown
    .replace(/\uE000/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\r\n?/g, '\n');
  const ctx: Context = {
    prefix: options?.idPrefix ?? '',
    ids: new Map(),
    toc: [],
    document: options?.document ?? false,
    assetExists: options?.assetExists,
    figures: [],
    heading: null,
  };
  const html = renderBlocks(md, ctx);
  return { html, toc: ctx.toc, figures: ctx.figures };
}
