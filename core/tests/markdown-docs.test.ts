// The Docs tabs' markdown (T25, ISC-84): `renderDocsMarkdown` is the document layer over the one renderer in
// `markdown.ts` — frontmatter split, h2/h3 table of contents, sections, numbered figures (mermaid fences and standalone
// images), word count. Each construct once with its exact HTML, then sanitisation, the figure contract on the real
// fixtures, `docsFor`, and the browser guard: nothing the module reaches imports a Bun or Node API.
import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { docsFor, renderDocsMarkdown } from '../src/markdown-docs.ts';
import { FIXTURES } from './helpers/read-tree.ts';

const html = (md: string): string => renderDocsMarkdown(md).html;
const fixture = (...parts: string[]): string => readFileSync(join(FIXTURES, ...parts), 'utf8');

describe('constructs, one each, exact HTML', () => {
  test('ATX headings carry unique slug ids', () => {
    expect(html('# Top\n\n## Two words\n\n###### Six ###')).toBe(
      '<h1 id="top">Top</h1>\n<h2 id="two-words">Two words</h2>\n<h6 id="six">Six</h6>',
    );
  });

  test('paragraphs join soft breaks; two trailing spaces or a backslash is a hard break', () => {
    expect(html('one  \ntwo\\\nthree\nfour\n\nnext')).toBe('<p>one<br>two<br>three four</p>\n<p>next</p>');
  });

  test('unordered, ordered and nested lists', () => {
    expect(html('- a\n  - b\n- c\n\n1. one\n2. two')).toBe('<ul><li>a<ul><li>b</li></ul></li><li>c</li></ul>\n<ol><li>one</li><li>two</li></ol>');
  });

  test('task-list boxes render as disabled checkboxes', () => {
    expect(html('- [ ] open\n- [x] done')).toBe(
      '<ul><li class="task open"><input type="checkbox" disabled> open</li><li class="task done"><input type="checkbox" checked disabled> done</li></ul>',
    );
  });

  test('blockquotes', () => {
    expect(html('> quoted *line*')).toBe('<blockquote><p>quoted <em>line</em></p></blockquote>');
  });

  test('fenced code keeps its language class and is escaped verbatim', () => {
    expect(html('```ts\nif (a < b && c) {}\n  indented\n```')).toBe('<pre><code class="lang-ts">if (a &lt; b &amp;&amp; c) {}\n  indented</code></pre>');
    expect(html('~~~\nplain\n~~~')).toBe('<pre><code>plain</code></pre>');
  });

  test('inline code, emphasis, strong, strikethrough', () => {
    expect(html('`a<b>` *i* **b** ~~s~~')).toBe('<p><code>a&lt;b&gt;</code> <em>i</em> <strong>b</strong> <s>s</s></p>');
    // Wildcard rule IDs inside strong text, as the spectant-001 plan writes them.
    expect(html('**FE-FW-*, DS-APP-* (open):** later')).toBe('<p><strong>FE-FW-*, DS-APP-* (open):</strong> later</p>');
  });

  test('links: relative targets kept, web links open beside, javascript: dropped to its label', () => {
    expect(html('[files](../../core/src/files.ts) [plan](plan.md#risks) [web](https://example.org) [x](javascript:alert(1))')).toBe(
      '<p><a href="../../core/src/files.ts">files</a> <a href="plan.md#risks">plan</a> <a href="https://example.org" target="_blank" rel="noopener">web</a> x</p>',
    );
  });

  test('GFM tables with alignment', () => {
    expect(html('| a | b | c |\n|:--|:-:|--:|\n| x | `y` | 3 |')).toBe(
      '<div class="mdtable"><table><thead><tr><th style="text-align:left">a</th><th style="text-align:center">b</th><th style="text-align:right">c</th></tr></thead>' +
        '<tbody><tr><td style="text-align:left">x</td><td style="text-align:center"><code>y</code></td><td style="text-align:right" data-num>3</td></tr></tbody></table></div>',
    );
  });

  test('horizontal rules', () => {
    expect(html('a\n\n---\n\nb')).toBe('<p>a</p>\n<hr>\n<p>b</p>');
  });

  test('⟨?: …⟩ open marks render as a mark, not inside code', () => {
    expect(html('Rendered client-side ⟨?: assuming no <svg> step⟩ here. `⟨?: code⟩`')).toBe(
      '<p>Rendered client-side <mark class="open-mark">⟨?: assuming no &lt;svg&gt; step⟩</mark> here. <code>⟨?: code⟩</code></p>',
    );
  });

  test('a mermaid fence becomes a numbered figure with escaped source and a caption, not rendered here', () => {
    const page = renderDocsMarkdown('## Approach\n\n```mermaid\nflowchart LR\n  a["x<br/>y"] --> b\n```\n');
    expect(page.html).toBe(
      '<h2 id="approach">Approach</h2>\n<figure class="mermaid-figure" data-figure="1"><pre class="mermaid">flowchart LR\n  a[&quot;x&lt;br/&gt;y&quot;] --&gt; b</pre><figcaption>Approach</figcaption></figure>',
    );
    expect(page.figures).toEqual([{ index: 1, kind: 'mermaid', diagram: 'flowchart', source: 'flowchart LR\n  a["x<br/>y"] --> b', caption: 'Approach' }]);
  });

  test('a mermaid title wins the caption; with no heading and no title the diagram kind stands in', () => {
    expect(renderDocsMarkdown('```mermaid\n---\ntitle: Data flow\n---\nflowchart TB\n```').figures[0]?.caption).toBe('Data flow');
    expect(renderDocsMarkdown('```mermaid\n%% a comment\nerDiagram\n```').figures[0]).toMatchObject({ caption: 'erDiagram', diagram: 'erDiagram' });
  });

  test('a standalone image becomes a figure; the file is asked about, never read; absent means missing', () => {
    const asked: string[] = [];
    const page = renderDocsMarkdown('![Mobile, before](.design/mobile-ist.png)\n\n![](shots/ok.png)', {
      assetExists: (src) => {
        asked.push(src);
        return src === 'shots/ok.png';
      },
    });
    expect(asked).toEqual(['.design/mobile-ist.png', 'shots/ok.png']);
    expect(page.html).toBe(
      '<figure class="image-figure missing" data-figure="1" data-missing><div class="figure-missing" role="img" aria-label="Mobile, before"><code>.design/mobile-ist.png</code></div><figcaption>Mobile, before</figcaption></figure>\n' +
        '<figure class="image-figure" data-figure="2"><img src="shots/ok.png" alt="" loading="lazy"><figcaption>ok.png</figcaption></figure>',
    );
    expect(page.figures).toEqual([
      { index: 1, kind: 'image', src: '.design/mobile-ist.png', alt: 'Mobile, before', caption: 'Mobile, before', missing: true },
      { index: 2, kind: 'image', src: 'shots/ok.png', alt: '', caption: 'ok.png' },
    ]);
  });

  test('an image off the machine is never loaded: a figure with a link, flagged remote', () => {
    const page = renderDocsMarkdown('![chart](https://example.org/c.png)');
    expect(page.html).toBe(
      '<figure class="image-figure remote" data-figure="1" data-remote><a href="https://example.org/c.png" target="_blank" rel="noopener">https://example.org/c.png</a><figcaption>chart</figcaption></figure>',
    );
    expect(page.html).not.toContain('<img');
    expect(page.figures[0]).toMatchObject({ kind: 'image', remote: true });
  });
});

describe('the page model', () => {
  test('frontmatter splits off into a flat map; none is null', () => {
    const page = renderDocsMarkdown('---\nspec: 002\nstatus: draft\nviewports: [390, 820]\n---\n\n# Plan\n');
    expect(page.frontmatter).toEqual({ spec: '002', status: 'draft', viewports: '[390, 820]' });
    expect(page.html).toBe('<h1 id="plan">Plan</h1>');
    expect(renderDocsMarkdown('# Plan').frontmatter).toBeNull();
  });

  test('toc holds h2 and h3 only, ids unique; sections hold every heading', () => {
    const page = renderDocsMarkdown('# Doc\n\n## Round 1\n\n### Q1 · Where?\n\n#### deep\n\n## Round 1\n\n### Q1 · Where?\n');
    expect(page.toc).toEqual([
      { level: 2, text: 'Round 1', anchor: 'round-1' },
      { level: 3, text: 'Q1 · Where?', anchor: 'q1-where' },
      { level: 2, text: 'Round 1', anchor: 'round-1-2' },
      { level: 3, text: 'Q1 · Where?', anchor: 'q1-where-2' },
    ]);
    expect(page.sections.map((s) => [s.level, s.id, s.heading])).toEqual([
      [1, 'doc', 'Doc'],
      [2, 'round-1', 'Round 1'],
      [3, 'q1-where', 'Q1 · Where?'],
      [4, 'deep', 'deep'],
      [2, 'round-1-2', 'Round 1'],
      [3, 'q1-where-2', 'Q1 · Where?'],
    ]);
    expect(new Set(page.toc.map((t) => t.anchor)).size).toBe(page.toc.length);
  });

  test('idPrefix applies to every id', () => {
    expect(renderDocsMarkdown('## A', { idPrefix: 'plan-' }).toc).toEqual([{ level: 2, text: 'A', anchor: 'plan-a' }]);
  });

  test('wordCount counts prose, not code or diagram source', () => {
    expect(renderDocsMarkdown('---\nspec: 1\n---\n# Two words\n\nThree more words.\n\n```\nnot counted here\n```\n\n```mermaid\nflowchart LR\n```').wordCount).toBe(5);
  });

  test('deterministic: the same text renders the same page', () => {
    const md = fixture('spectant-001', 'specs', '001-app-skeleton', 'plan.md');
    expect(JSON.stringify(renderDocsMarkdown(md))).toBe(JSON.stringify(renderDocsMarkdown(md)));
  });
});

describe('sanitisation', () => {
  test('raw HTML is escaped, never passed through; comments dropped', () => {
    const out = html('<script>alert(1)</script>\n\n<!-- note -->\n<img src=x onerror=alert(1)>\n\n## <b>h</b>');
    expect(out).not.toContain('<script');
    expect(out).not.toContain('<img');
    expect(out).not.toContain('note');
    expect(out).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(out).toContain('<h2 id="b-h-b">&lt;b&gt;h&lt;/b&gt;</h2>');
  });

  test('image sources and captions cannot break out of an attribute or load a script', () => {
    const out = html('![x" onerror="alert(1)](a.png)\n\n![y](javascript:alert(1))\n\n![z](data:image/png;base64,AAAA)');
    expect(out).not.toContain('" onerror');
    expect(out).not.toContain('javascript:');
    expect(out).not.toContain('src="data:');
  });

  test('only the tags the renderer emits appear', () => {
    const allowed = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'br', 'ul', 'ol', 'li', 'input', 'blockquote', 'pre', 'code', 'em', 'strong', 's', 'a', 'div', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'hr', 'mark', 'figure', 'figcaption', 'img', 'span']);
    const docs = [
      fixture('spectant-001', 'specs', '001-app-skeleton', 'plan.md'),
      fixture('spectant-001', 'specs', '001-app-skeleton', 'design.md'),
      fixture('spectant-001', 'specs', '001-app-skeleton', 'context.md'),
      fixture('leadgen', 'specs', 'constitution.md'),
    ];
    const tags = new Set(docs.flatMap((md) => [...html(md).matchAll(/<\/?([a-zA-Z][\w-]*)/g)].map((m) => m[1] ?? '')));
    expect([...tags].filter((t) => !allowed.has(t))).toEqual([]);
  });
});

describe('the fixtures', () => {
  test('harbor 002 plan: one mermaid figure under its Approach heading', () => {
    const page = renderDocsMarkdown(fixture('harbor', 'specs', '002-web-console', 'plan.md'));
    expect(page.figures.map((f) => [f.kind, f.caption])).toEqual([['mermaid', 'Approach']]);
    expect(page.html.match(/<figure class="mermaid-figure" data-figure="\d+">/g)).toHaveLength(1);
  });

  test('spectant-001 plan: two mermaid figures, numbered 1 and 2', () => {
    const page = renderDocsMarkdown(fixture('spectant-001', 'specs', '001-app-skeleton', 'plan.md'));
    expect(page.figures.map((f) => [f.index, f.kind])).toEqual([
      [1, 'mermaid'],
      [2, 'mermaid'],
    ]);
    expect(page.html).not.toContain('lang-mermaid');
  });

  test('spectant-001 design: the Ist screenshots under the gitignored .design/ are figures flagged missing', () => {
    const folder = join(FIXTURES, 'spectant-001', 'specs', '001-app-skeleton');
    const page = renderDocsMarkdown(fixture('spectant-001', 'specs', '001-app-skeleton', 'design.md'), {
      assetExists: (src) => existsSync(join(folder, src)),
    });
    const images = page.figures.filter((f) => f.kind === 'image');
    expect(images.map((f) => [f.src, f.missing])).toEqual([
      ['.design/mobile-ist.png', true],
      ['.design/tablet-ist.png', true],
      ['.design/desktop-ist.png', true],
    ]);
    expect(page.frontmatter?.design_track).toBe('app');
    expect(page.toc.filter((t) => t.level === 2).map((t) => t.text)).toEqual(['Mobile (390)', 'Tablet (820)', 'Desktop (1440)', 'Viewport-übergreifend']);
  });

  test('spectant-001 context: rounds as h2, questions as h3 in the TOC', () => {
    const page = renderDocsMarkdown(fixture('spectant-001', 'specs', '001-app-skeleton', 'context.md'));
    const rounds = page.toc.filter((t) => t.level === 2 && t.text.startsWith('Round'));
    expect(rounds.length).toBeGreaterThanOrEqual(4);
    expect(page.toc.some((t) => t.level === 3 && t.text.startsWith('Q1 · '))).toBe(true);
    expect(page.frontmatter?.rounds).toBe('4');
  });

  test('leadgen constitution: frontmatter, tables, no stray pipe rows', () => {
    const page = renderDocsMarkdown(fixture('leadgen', 'specs', 'constitution.md'));
    expect(page.frontmatter?.repo).toBe('lead-generation');
    expect(page.html).toContain('<table>');
    expect(page.html).not.toMatch(/<p>\|/);
  });
});

describe('docsFor', () => {
  test('which docs a spec type has, from TYPE_NEEDS, with the command that writes each', () => {
    expect(docsFor('feature')).toEqual({
      plan: { applies: true, command: '/spec-plan' },
      design: { applies: true, command: '/spec-design' },
      decisions: { applies: true, command: null },
      constitution: { applies: true, command: '/spec-bootstrap' },
    });
    expect(docsFor('refactor').plan.applies).toBe(false);
    expect(docsFor('bug').design.applies).toBe(false);
    expect(docsFor('infra').plan.applies).toBe(true);
    expect(docsFor(null).plan.applies).toBe(false);
  });
});

describe('browser guard', () => {
  /**
   * Every module `markdown-docs.ts` reaches through its static relative value imports, itself included. An
   * `import type` is erased from the bundle (stage.ts types a gate state from gates.ts, which hashes with node:crypto),
   * so it is not followed.
   */
  function reach(file: string, seen = new Set<string>()): Set<string> {
    if (seen.has(file)) return seen;
    seen.add(file);
    const source = readFileSync(file, 'utf8');
    for (const m of source.matchAll(/^\s*(?:import|export)\s+(?!type\b)[^;]*?\bfrom\s+['"](\.[^'"]+)['"]/gm)) reach(resolve(dirname(file), m[1] ?? ''), seen);
    return seen;
  }

  test('no module reached from markdown-docs.ts imports Bun or Node, or touches Bun.*', () => {
    const files = [...reach(join(import.meta.dir, '..', 'src', 'markdown-docs.ts'))];
    expect(files.length).toBeGreaterThanOrEqual(3);
    const offending = files.filter((file) => {
      const source = readFileSync(file, 'utf8');
      return /\bBun\.|\bprocess\.|\brequire\(|(?:from|import)\s*\(?\s*['"](?:node:|bun|fs|path|os|child_process)/.test(source);
    });
    expect(offending).toEqual([]);
  });

  test('the guard bites', () => {
    expect(/(?:from|import)\s*\(?\s*['"](?:node:|bun|fs|path|os|child_process)/.test("import { readFileSync } from 'node:fs';")).toBe(true);
  });
});
