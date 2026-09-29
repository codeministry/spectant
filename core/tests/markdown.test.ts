// The Brief's markdown renderer (spec 001 T38, ISC-16), ported from the old SpecMarkdown: headings with a TOC, fences,
// tables, nested lists with checkboxes, blockquotes, rules, inline code, bold, italic, strike and links. Every string
// is escaped, raw HTML never passes through, HTML comments are dropped, and only safe link targets survive. The module
// sits in the browser barrel, so it must not reach for a Bun or Node API.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseTldr } from '../src/tldr.ts';
import { renderMarkdown } from '../src/markdown.ts';

const FIXTURES = join(import.meta.dir, '..', 'fixtures');

describe('blocks', () => {
  test('headings carry ids and fill the TOC; a repeated heading gets a suffix; idPrefix applies', () => {
    const page = renderMarkdown('# Top `code`\n\n## Next up\n\n## Next up\n', { idPrefix: 'brief-' });
    expect(page.toc).toEqual([
      { level: 1, text: 'Top code', anchor: 'brief-top-code' },
      { level: 2, text: 'Next up', anchor: 'brief-next-up' },
      { level: 2, text: 'Next up', anchor: 'brief-next-up-2' },
    ]);
    expect(page.html).toContain('<h1 id="brief-top-code">Top <code>code</code></h1>');
    expect(page.html).toContain('<h2 id="brief-next-up-2">Next up</h2>');
  });

  test('nested lists with checkboxes, ordered lists, wrapped items', () => {
    const html = renderMarkdown('- [x] done\n  - [ ] open child\n- plain\n  continued\n\n1. one\n2. two\n').html;
    expect(html).toContain('<ul><li class="task done"><span class="cb on" aria-label="done">●</span> done<ul><li class="task open">');
    expect(html).toContain('<li>plain continued</li>');
    expect(html).toContain('<ol><li>one</li><li>two</li></ol>');
  });

  test('fences keep their text verbatim and escaped; mermaid stays a bare fence', () => {
    const html = renderMarkdown('```ts\nconst a = "<b>" && 1;\n```\n\n```mermaid\nflowchart LR\n  a --> b\n```\n').html;
    expect(html).toContain('<pre><code class="lang-ts">const a = &quot;&lt;b&gt;&quot; &amp;&amp; 1;</code></pre>');
    expect(html).toContain('<pre><code class="lang-mermaid">flowchart LR\n  a --&gt; b</code></pre>');
  });

  test('tables with alignment, blockquotes, callouts and rules', () => {
    const html = renderMarkdown('| a | b |\n|:--|--:|\n| x | 12 |\n\n> quoted **bold**\n\n> [!NOTE]\n> careful\n\n---\n').html;
    expect(html).toContain('<table><thead><tr><th style="text-align:left">a</th><th style="text-align:right">b</th></tr></thead>');
    expect(html).toContain('<td style="text-align:right" data-num>12</td>');
    expect(html).toContain('<blockquote><p>quoted <strong>bold</strong></p></blockquote>');
    expect(html).toContain('<blockquote class="callout" data-kind="note"><p>careful</p></blockquote>');
    expect(html).toContain('<hr>');
  });
});

describe('inline', () => {
  test('bold, italic, strike, code spans untouched', () => {
    const html = renderMarkdown('**b** *i* _u_ ~~s~~ `**not** <x>` principal_stated_goal').html;
    expect(html).toBe('<p><strong>b</strong> <em>i</em> <em>u</em> <s>s</s> <code>**not** &lt;x&gt;</code> principal_stated_goal</p>');
  });

  test('safe links render; web links open beside the page; unsafe targets fall back to the label', () => {
    const html = renderMarkdown('[docs](plan.md#risks) [web](https://example.org/a?b=1&c=2) [x](javascript:alert(1)) [y](data:text/html,hi)').html;
    expect(html).toContain('<a href="plan.md#risks">docs</a>');
    expect(html).toContain('<a href="https://example.org/a?b=1&amp;c=2" target="_blank" rel="noopener">web</a>');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('data:text');
    expect(html).toContain(' x');
  });

  test('a bare web address links itself, without the sentence punctuation', () => {
    expect(renderMarkdown('See https://example.org/x.').html).toBe(
      '<p>See <a href="https://example.org/x" target="_blank" rel="noopener">https://example.org/x</a>.</p>',
    );
  });
});

describe('safety', () => {
  test('raw HTML never passes through; comments are dropped', () => {
    const html = renderMarkdown('<!-- hidden -->\n<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n# <b>h</b>\n').html;
    expect(html).not.toContain('hidden');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&lt;b&gt;h&lt;/b&gt;');
  });

  test('quotes cannot break out of an attribute; input text cannot forge a code placeholder', () => {
    const html = renderMarkdown('[a](https://x.org/"onmouseover="alert(1)) `c` 0').html;
    expect(html).not.toContain('"onmouseover');
    expect(html.match(/<code>/g)).toHaveLength(1);
  });

  test('no Bun or Node API in the module source', () => {
    const source = readFileSync(join(import.meta.dir, '..', 'src', 'markdown.ts'), 'utf8');
    expect(source).not.toMatch(/\bBun\.|from ['"](?:node:|fs|path|bun)/);
  });
});

describe('the harbor Brief', () => {
  test('renders every TL;DR section without a stray marker', () => {
    const tldr = parseTldr(readFileSync(join(FIXTURES, 'harbor', 'specs', 'tldr.md'), 'utf8'));
    const page = renderMarkdown(Object.values(tldr.sections).join('\n\n'));
    expect(page.html).toContain('<li><strong>002</strong> Web console: 25 of 30 closed; one question open about the empty state.</li>');
    expect(page.html).toContain('<code>harbor sync --dry-run</code>');
    expect(page.html).not.toContain('section:');
    expect(page.toc).toEqual([]);
  });
});
