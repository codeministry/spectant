// The structured reading of two Docs tab files (spec 024, ISC-149; the prototype's Decisions and Constitution tabs):
// context.md's question rounds and the constitution's lanes and gate tiers. The Docs tabs still render the whole
// file through `markdown-docs.ts`; this module adds the blocks the prototype shows as cards above or instead of the
// prose. Pure and deterministic, no Bun or Node API: the web bundle may import it. The `##`/`###` block split is the
// one timeline.ts uses for its decision entries.
import type { ConstitutionLane, ConstitutionView, DecisionLog, DecisionOption, DecisionQuestion, GateTier } from './files.ts';
import { tableCells } from './markdown.ts';

/** `### Qn · <question>`; the number is optional (`### Q · …` in build rounds). */
export const QUESTION_HEADER = /^### Q(\d*)\s*·\s*(.+?)\s*$/;
const FENCE = /^\s*(```|~~~)/;
/** `## Goal — confirmed <ts>`; the same header derived-stages.ts and timeline.ts date the goal lock from. */
const GOAL = /^## Goal\s+[—–-]+\s+confirmed\s+(\S+)\s*$/;
/** `## Round 1b — design pass, 2026-10-12`: the title, and the date when the header carries one. */
const ROUND = /^## (Round\s+\S+.*?)(?:,\s*(\d{4}-\d{2}-\d{2}\S*))?\s*$/;
/** A recommended offer, in either catalogue language: `(recommended)`, `(Recommended)`, `(empfohlen)`. */
const RECOMMENDED = /\s*\((?:recommended|empfohlen)\)/i;

export interface Block {
  header: string;
  lines: string[];
}

/** Splits a Markdown file into `##`/`###` blocks, ignoring headers inside fenced code. */
export function blocksOf(text: string): Block[] {
  const blocks: Block[] = [];
  let current: Block | null = null;
  let fenced = false;
  for (const line of text.split(/\r?\n/)) {
    if (FENCE.test(line)) fenced = !fenced;
    if (!fenced && /^#{2,3} /.test(line)) {
      current = { header: line, lines: [] };
      blocks.push(current);
    } else {
      current?.lines.push(line);
    }
  }
  return blocks;
}

/** The `- Key: value` items of a block, a value continued on indented lines joined with one space. */
function items(lines: readonly string[]): Array<{ key: string; value: string }> {
  const out: Array<{ key: string; value: string }> = [];
  let last: { key: string; value: string } | null = null;
  for (const line of lines) {
    const item = /^-\s+([^:]+?):\s*(.*)$/.exec(line);
    if (item) {
      last = { key: (item[1] ?? '').toLowerCase(), value: (item[2] ?? '').trim() };
      out.push(last);
    } else if (last !== null && /^\s+\S/.test(line)) {
      last.value = `${last.value} ${line.trim()}`.trim();
    } else {
      last = null;
    }
  }
  return out;
}

/** Splits on `sep` outside parentheses and backticks. */
function splitTop(value: string, sep: ',' | '|'): string[] {
  const parts: string[] = [];
  let depth = 0;
  let code = false;
  let current = '';
  for (const ch of value) {
    if (ch === '`') code = !code;
    else if (!code && ch === '(') depth += 1;
    else if (!code && ch === ')') depth = Math.max(0, depth - 1);
    if (ch === sep && depth === 0 && !code) {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts.map((p) => p.trim()).filter((p) => p !== '');
}

const unquote = (value: string): string => value.replace(/`/g, '');

function options(value: string | undefined): DecisionOption[] {
  if (value === undefined) return [];
  return splitTop(value, '|').map((text) => ({ text: unquote(text.replace(RECOMMENDED, '')).trim(), recommended: RECOMMENDED.test(text) }));
}

const valueOf = (list: ReadonlyArray<{ key: string; value: string }>, key: string): string | undefined => list.find((i) => i.key === key)?.value;

/** One `### Qn · …` block as a question; timeline.ts reads its decision entries through it as well. */
export function parseQuestion(block: Block, n: string): DecisionQuestion {
  const list = items(block.lines);
  const landed = valueOf(list, 'landed in');
  return {
    n: n === '' ? null : n,
    title: (QUESTION_HEADER.exec(block.header)?.[2] ?? '').trim(),
    from: valueOf(list, 'from') ?? null,
    offered: options(valueOf(list, 'offered')),
    chosen: valueOf(list, 'chosen') ?? null,
    landedIn: landed === undefined ? [] : splitTop(landed, ',').map(unquote),
  };
}

/**
 * context.md as the Decisions tab's cards: the goal lock (its first paragraph and the confirmation time) and every
 * `## Round …` with its `- Shapes offered:` / `- Chosen:` lines and its `### Qn · …` blocks (`- From:`, `- Offered:`
 * split on `|` with the recommended mark, `- Chosen:`, `- Landed in:` split on top-level commas). Other `###` blocks
 * (notes, marks) and `## Still open` are left to the prose.
 */
export function parseDecisionLog(body: string): DecisionLog {
  let goal: DecisionLog['goal'] = null;
  const rounds: Array<{ id: string; title: string; date: string | null; shapes: DecisionOption[]; shapeChosen: string | null; questions: DecisionQuestion[] }> = [];
  let round: (typeof rounds)[number] | null = null;
  for (const block of blocksOf(body)) {
    if (block.header.startsWith('## ')) {
      round = null;
      const g = GOAL.exec(block.header);
      if (g?.[1] && goal === null) {
        const text = block.lines.join('\n').trim().split(/\n\s*\n/)[0]?.replace(/\s*\n\s*/g, ' ').trim() ?? '';
        if (text !== '') goal = { text, confirmed: g[1] };
        continue;
      }
      const r = ROUND.exec(block.header);
      if (r?.[1]) {
        const list = items(block.lines);
        const shapes = options(valueOf(list, 'shapes offered'));
        round = { id: `round-${String(rounds.length)}`, title: r[1].trim(), date: r[2] ?? null, shapes, shapeChosen: shapes.length > 0 ? (valueOf(list, 'chosen') ?? null) : null, questions: [] };
        rounds.push(round);
      }
      continue;
    }
    const q = QUESTION_HEADER.exec(block.header);
    if (q && round) round.questions.push(parseQuestion(block, q[1] ?? ''));
  }
  return { goal, rounds };
}

/** The rows of the first table under `## <heading>`, keyed by the header row's lower-cased cells. */
function sectionTable(body: string, heading: RegExp): Array<Record<string, string>> {
  const block = blocksOf(body).find((b) => b.header.startsWith('## ') && heading.test(b.header.slice(3).trim()));
  if (!block) return [];
  const rows = block.lines.filter((l) => /^\s*\|/.test(l));
  const head = rows[0];
  if (head === undefined) return [];
  const keys = tableCells(head).map((c) => c.toLowerCase());
  return rows
    .slice(1)
    .filter((l) => !/^\s*\|?\s*:?-{3,}/.test(l))
    .map((l) => Object.fromEntries(tableCells(l).map((c, i) => [keys[i] ?? String(i), c])));
}

const column = (row: Record<string, string>, pattern: RegExp): string | undefined => Object.entries(row).find(([k]) => pattern.test(k))?.[1];

/** The constitution's `## Lanes` table (lane, path prefixes, lane probe) and `## Gates` tiers (tier, command, when). */
export function parseConstitutionView(body: string): ConstitutionView {
  const lanes: ConstitutionLane[] = sectionTable(body, /^Lanes\b/i).flatMap((row) => {
    const lane = unquote(column(row, /^lane$/) ?? '').trim();
    if (lane === '') return [];
    const probe = column(row, /probe/);
    return [{ lane, paths: splitTop(column(row, /path/) ?? '', ',').map(unquote), probe: probe ? unquote(probe) : null }];
  });
  const tiers: GateTier[] = sectionTable(body, /^Gates?\b/i).flatMap((row) => {
    const tier = unquote(column(row, /^tier$/) ?? '').trim();
    if (tier === '') return [];
    return [{ tier, command: unquote(column(row, /command/) ?? ''), runsWhen: unquote(column(row, /runs|when/) ?? '') }];
  });
  return { lanes, tiers };
}
