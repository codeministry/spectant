// The repository documents of `/spec doc` and `/spec tldr` (spec 074, T12–T14, T18–T20; ISC-618, ISC-619, ISC-620):
// `docTarget`, `docCheck`, `tldrTarget` and `tldrCheck` over temporary repositories, never this repository's own
// `specs/`. Every case that must write nothing compares a snapshot of the whole tree before and after.
import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { docCheck, docTarget, tldrCheck, tldrTarget } from '../src/repo-docs.ts';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function repo(files: Record<string, string | Uint8Array> = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'repo-docs-'));
  roots.push(root);
  mkdirSync(join(root, 'specs'), { recursive: true });
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

/** Every file under `root` with its bytes as hex, so any write, new file or removal shows. */
function snapshot(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else out[relative(root, path)] = readFileSync(path).toString('hex');
    }
  };
  walk(root);
  return out;
}

const TECH_KEYS = ['overview', 'stack', 'architecture', 'risks'] as const;

function techText(keys: readonly string[] = TECH_KEYS): string {
  return keys.map((key) => `<!-- section: ${key} -->\n\n## ${key}\n\nSome ${key} prose.\n`).join('\n');
}

function specText(slug: string, phase: string, updated: string): string {
  return ['---', `task: "${slug}"`, `slug: ${slug}`, 'spec_type: feature', `phase: ${phase}`, `updated: ${updated}`, '---', '', `# ${slug}`, ''].join('\n');
}

const TLDR_KEYS = ['overview', 'try', 'per-spec', 'risks', 'next'] as const;

function tldrText(options: { keys?: readonly string[]; generated?: string | null; perSpec?: string } = {}): string {
  const generated = options.generated === undefined ? '2026-10-20T12:00:00.000Z' : options.generated;
  const head = ['---', ...(generated === null ? [] : [`generated: ${generated}`]), '---', ''];
  const body = (options.keys ?? TLDR_KEYS).map((key) => `<!-- section: ${key} -->\n\n${key === 'per-spec' ? (options.perSpec ?? 'Spec 001 and spec 002.') : `The ${key}.`}\n`);
  return [...head, ...body].join('\n');
}

/** Two open specs (001, 002) and one complete (003), all updated before the TL;DR's default `generated:`. */
const SPECS = {
  'specs/001-alpha/spec.md': specText('001-alpha', 'scoping', '2026-10-18T10:00:00.000Z'),
  'specs/002-beta/spec.md': specText('002-beta', 'building', '2026-10-19T10:00:00.000Z'),
  'specs/003-gamma/spec.md': specText('003-gamma', 'complete', '2026-10-17T10:00:00.000Z'),
};

describe('doc target', () => {
  test('copies an existing tech.md byte-identical to tech.prev.md and names tech.md as the target', () => {
    // Bytes that a text round trip would change: a BOM, CRLF and a non-UTF-8 byte.
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('# Tech\r\n\r\nHand-written line.\r\n'), 0xff, 0x0a]);
    const root = repo({ 'specs/tech.md': bytes });
    const result = docTarget(root);
    expect(result).toEqual({ target: 'specs/tech.md', previous: 'specs/tech.prev.md', keep: false });
    expect(Buffer.compare(readFileSync(join(root, 'specs/tech.prev.md')), Buffer.from(bytes))).toBe(0);
    expect(Buffer.compare(readFileSync(join(root, 'specs/tech.md')), Buffer.from(bytes))).toBe(0);
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });

  test('replaces an older tech.prev.md', () => {
    const root = repo({ 'specs/tech.md': 'new text\n', 'specs/tech.prev.md': 'older copy\n' });
    expect(docTarget(root).previous).toBe('specs/tech.prev.md');
    expect(readFileSync(join(root, 'specs/tech.prev.md'), 'utf8')).toBe('new text\n');
  });

  test('without a tech.md writes nothing and names no previous', () => {
    const root = repo(SPECS);
    const before = snapshot(root);
    expect(docTarget(root)).toEqual({ target: 'specs/tech.md', previous: null, keep: false });
    expect(snapshot(root)).toEqual(before);
  });

  test('with keep writes nothing and only names the target', () => {
    const root = repo({ 'specs/tech.md': techText(), 'specs/tech.prev.md': 'older copy\n' });
    const before = snapshot(root);
    expect(docTarget(root, { keep: true })).toEqual({ target: 'specs/tech.md', previous: null, keep: true });
    expect(snapshot(root)).toEqual(before);
  });

  test('with keep and without a tech.md writes nothing', () => {
    const root = repo();
    const before = snapshot(root);
    expect(docTarget(root, { keep: true })).toEqual({ target: 'specs/tech.md', previous: null, keep: true });
    expect(snapshot(root)).toEqual(before);
  });
});

describe('doc check', () => {
  test('a complete tech.md is ok with no findings and nothing written', () => {
    const root = repo({ 'specs/tech.md': `---\ngenerated: 2026-10-20T12:00:00.000Z\n---\n\n${techText()}` });
    const before = snapshot(root);
    expect(docCheck(root)).toEqual({ ok: true, findings: [] });
    expect(snapshot(root)).toEqual(before);
  });

  for (const missing of TECH_KEYS) {
    test(`a tech.md without ${missing} names exactly that key`, () => {
      const root = repo({ 'specs/tech.md': techText(TECH_KEYS.filter((k) => k !== missing)) });
      const result = docCheck(root);
      expect(result.ok).toBe(false);
      expect(result.findings.map((f) => [f.code, f.subject])).toEqual([['tech-section', missing]]);
    });
  }

  test('a tech.md without markers names every key', () => {
    const root = repo({ 'specs/tech.md': '# Tech\n\nNo markers.\n' });
    expect(docCheck(root).findings.map((f) => f.subject)).toEqual([...TECH_KEYS]);
  });

  test('no tech.md is one missing-file finding', () => {
    const root = repo();
    const before = snapshot(root);
    const result = docCheck(root);
    expect(result.ok).toBe(false);
    expect(result.findings).toEqual([{ code: 'missing-file', subject: 'specs/tech.md', message: 'specs/tech.md does not exist.' }]);
    expect(snapshot(root)).toEqual(before);
  });
});

describe('tldr target', () => {
  test('names tldr.md and writes nothing', () => {
    const root = repo(SPECS);
    const before = snapshot(root);
    expect(tldrTarget(root)).toEqual({ target: 'specs/tldr.md' });
    expect(snapshot(root)).toEqual(before);
  });
});

describe('tldr check', () => {
  test('a complete, fresh tldr.md naming every open spec is ok and writes nothing', () => {
    const root = repo({ ...SPECS, 'specs/tldr.md': tldrText() });
    const before = snapshot(root);
    expect(tldrCheck(root)).toEqual({ ok: true, stale: false, findings: [] });
    expect(snapshot(root)).toEqual(before);
  });

  test('a missing section key is named', () => {
    const root = repo({ ...SPECS, 'specs/tldr.md': tldrText({ keys: TLDR_KEYS.filter((k) => k !== 'try') }) });
    const result = tldrCheck(root);
    expect(result.ok).toBe(false);
    expect(result.findings.map((f) => [f.code, f.subject])).toEqual([['tldr-section', 'try']]);
  });

  test('no generated: is named, and the TL;DR counts as stale', () => {
    const root = repo({ ...SPECS, 'specs/tldr.md': tldrText({ generated: null }) });
    const result = tldrCheck(root);
    expect(result.ok).toBe(false);
    expect(result.stale).toBe(true);
    expect(result.findings.map((f) => [f.code, f.subject])).toEqual([['tldr-generated-missing', 'generated']]);
  });

  test('an invalid generated: is named', () => {
    const root = repo({ ...SPECS, 'specs/tldr.md': tldrText({ generated: 'yesterday' }) });
    expect(tldrCheck(root).findings.map((f) => f.code)).toEqual(['tldr-generated-invalid']);
  });

  test('an open spec the TL;DR never names is named; a complete one is not', () => {
    const root = repo({ ...SPECS, 'specs/tldr.md': tldrText({ perSpec: 'Only spec 001 so far.' }) });
    const result = tldrCheck(root);
    expect(result.ok).toBe(false);
    expect(result.findings.map((f) => [f.code, f.subject])).toEqual([['tldr-unnamed-spec', '002']]);
  });

  test('an archived spec is not required', () => {
    const root = repo({ ...SPECS, 'specs/archive/004-delta/spec.md': specText('004-delta', 'scoping', '2026-10-18T10:00:00.000Z'), 'specs/tldr.md': tldrText() });
    expect(tldrCheck(root).ok).toBe(true);
  });

  test('a round after generated: makes it stale, from the spec folder rounds.jsonl', () => {
    const rounds = `${JSON.stringify({ round: 1, ts: '2026-10-21T09:00:00.000Z' })}\n`;
    const root = repo({ ...SPECS, 'specs/002-beta/rounds.jsonl': rounds, 'specs/tldr.md': tldrText() });
    const result = tldrCheck(root);
    expect(result.stale).toBe(true);
    expect(result.findings).toEqual([]);
  });

  test('no tldr.md is one missing-file finding', () => {
    const root = repo(SPECS);
    const before = snapshot(root);
    expect(tldrCheck(root)).toEqual({ ok: false, stale: false, findings: [{ code: 'missing-file', subject: 'specs/tldr.md', message: 'specs/tldr.md does not exist.' }] });
    expect(snapshot(root)).toEqual(before);
  });
});
