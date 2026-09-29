// The markdown renderer for the Brief (T38, ISC-16), ported from the old SpecMarkdown: headings, fences, tables,
// nested lists with checkboxes, blockquotes, rules, inline code, bold, italic, strike and links; every string escaped,
// raw HTML never passed through, HTML comments dropped. No Bun API and no Node API: the web app imports it.
//
// Not CommonMark and not trying to be: the spec format bounds what these files hold, and anything outside that shape
// falls through as an escaped paragraph. Differences from the old renderer, all narrowing: no images (the alt text
// stands in), no copy button and no bilingual callout title (the web app owns every visible label), and the
// private-use character U+E000 that brackets a code-span placeholder is dropped from the input, so text can never
// forge one.
import type { DocsPage, TocEntry } from './files.ts';

export interface MarkdownOptions {
  /** Prefix for heading anchors, so several documents on one page never collide. */
  readonly idPrefix?: string;
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

/** Link targets that may render: the web, mail, an in-page anchor, or a sibling markdown file. */
const SAFE_HREF = /^(?:https?:|mailto:|#|[\w./-]+\.md(?:#[\w-]*)?$)/;
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
  s = s.replace(/!\[([^\]\n]*)\]\(([^)\s]+)\)/g, (_, alt: string) => alt);
  s = s.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (_, label: string, href: string) => {
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
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>');
  s = s.replace(/(^|\s)_([^_\n]+)_(?=[\s.,;:!?)]|$)/g, '$1<em>$2</em>');
  s = s.replace(/~~([^~\n]+)~~/g, '<s>$1</s>');
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

function renderList(items: readonly Item[]): string {
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
        it.checked === null ? '' : `<span class="cb ${it.checked ? 'on' : 'off'}" aria-label="${it.checked ? 'done' : 'open'}">${it.checked ? '●' : '○'}</span> `;
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
      // A mermaid fence stays a bare fence: the web app finds it by its class and draws it.
      out.push(`<pre><code${lang ? ` class="lang-${esc(lang)}"` : ''}>${esc(body.join('\n'))}</code></pre>`);
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      const level = (heading[1] ?? '#').length;
      const text = heading[2] ?? '';
      const anchor = uniqueId(text);
      ctx.toc.push({ level, text: text.replace(/`/g, ''), anchor });
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
      out.push(renderList(items));
      continue;
    }

    const para: string[] = [];
    while (i < lines.length && !blank(at(i)) && !HEADING.test(at(i)) && !FENCE.test(at(i)) && !ITEM.test(at(i)) && !QUOTE.test(at(i)) && !isTable(i)) {
      para.push(at(i++).trim());
    }
    if (para.length > 0) out.push(`<p>${renderInline(para.join(' '))}</p>`);
    else i += 1;
  }
  return out.join('\n');
}

/** The rendered HTML plus its table of contents (the same shape as the Docs area's pages). */
export function renderMarkdown(markdown: string, options?: MarkdownOptions): DocsPage {
  // HTML comments are authoring notes (`<!-- section: overview -->`); they never render.
  const md = markdown
    .replace(/\uE000/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\r\n?/g, '\n');
  const ctx: Context = { prefix: options?.idPrefix ?? '', ids: new Map(), toc: [] };
  const html = renderBlocks(md, ctx);
  return { html, toc: ctx.toc };
}
