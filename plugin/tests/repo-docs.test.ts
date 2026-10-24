// The repository documents of `/spec doc` and `/spec tldr` (spec 074, T12–T14, T18–T20; ISC-618, ISC-619, ISC-620):
// `docTarget`, `docCheck`, `tldrTarget` and `tldrCheck` over temporary repositories, never this repository's own
// `specs/`, and the `doc` and `tldr` commands of `spec-check` through its router (T15, T16, T21; ISC-621). Every case
// that must write nothing compares a snapshot of the whole tree before and after.
import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { docCheck, docTarget, tldrCheck, tldrTarget } from '../src/repo-docs.ts';
import { main } from '../src/spec-check.ts';

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

/** `spec-check <argv>` in process at `cwd`: its exit code, what it printed on stdout and on stderr. */
async function cli(cwd: string, ...argv: string[]): Promise<{ code: number; out: string; err: string }> {
  const out: string[] = [];
  const err: string[] = [];
  const stdout = spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
    out.push(String(chunk));
    return true;
  });
  const stderr = spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
    err.push(String(chunk));
    return true;
  });
  try {
    const code = await main(argv, cwd);
    return { code, out: out.join(''), err: err.join('') };
  } finally {
    stdout.mockRestore();
    stderr.mockRestore();
  }
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

  test('through the CLI: `doc target --json` prints the result object, `--keep` writes nothing', async () => {
    const root = repo({ 'specs/tech.md': techText() });
    const kept = snapshot(root);
    const keep = await cli(root, 'doc', 'target', '--keep', '--json');
    expect(keep.code).toBe(0);
    expect(JSON.parse(keep.out)).toEqual({ target: 'specs/tech.md', previous: null, keep: true });
    expect(snapshot(root)).toEqual(kept);
    const run = await cli(root, 'doc', 'target', '--json');
    expect(run).toMatchObject({ code: 0, err: '' });
    expect(JSON.parse(run.out)).toEqual({ target: 'specs/tech.md', previous: 'specs/tech.prev.md', keep: false });
    expect(readFileSync(join(root, 'specs/tech.prev.md'), 'utf8')).toBe(techText());
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

  test('through the CLI: `doc check` exits 3 `incomplete` with every finding, exit 0 with the result when complete', async () => {
    const root = repo({ 'specs/tech.md': techText(['overview', 'stack']) });
    const open = await cli(root, 'doc', 'check', '--json');
    expect(open.code).toBe(3);
    expect(JSON.parse(open.out)).toEqual({ error: 'incomplete', command: 'doc', detail: docCheck(root).findings });
    const person = await cli(root, 'doc', 'check');
    expect(person.code).toBe(3);
    expect(person.err).toContain('architecture');
    expect(person.err).toContain('risks');
    writeFileSync(join(root, 'specs/tech.md'), techText());
    const done = await cli(root, 'doc', 'check', '--json');
    expect(done.code).toBe(0);
    expect(JSON.parse(done.out)).toEqual({ ok: true, findings: [] });
    const unknown = await cli(root, 'doc', 'sweep', '--json');
    expect(unknown.code).toBe(1);
    expect(JSON.parse(unknown.out)).toMatchObject({ error: 'bad-args', command: 'doc' });
  });
});

describe('tldr target', () => {
  test('names tldr.md and writes nothing', () => {
    const root = repo(SPECS);
    const before = snapshot(root);
    expect(tldrTarget()).toEqual({ target: 'specs/tldr.md' });
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

  test('through the CLI: `tldr check` exits 3 when incomplete, 0 and says stale when complete but stale', async () => {
    const root = repo({ ...SPECS, 'specs/tldr.md': tldrText({ keys: TLDR_KEYS.filter((k) => k !== 'risks') }) });
    const open = await cli(root, 'tldr', 'check', '--json');
    expect(open.code).toBe(3);
    expect(JSON.parse(open.out)).toEqual({ error: 'incomplete', command: 'tldr', detail: tldrCheck(root).findings });
    expect((await cli(root, 'tldr', 'check')).err).toContain('risks');
    const rounds = `${JSON.stringify({ round: 1, ts: '2026-10-21T09:00:00.000Z' })}\n`;
    writeFileSync(join(root, 'specs/002-beta/rounds.jsonl'), rounds);
    writeFileSync(join(root, 'specs/tldr.md'), tldrText());
    const stale = await cli(root, 'tldr', 'check', '--json');
    expect(stale.code).toBe(0);
    expect(JSON.parse(stale.out)).toEqual({ ok: true, stale: true, findings: [] });
    const person = await cli(root, 'tldr', 'check');
    expect(person.code).toBe(0);
    expect(person.out).toContain('stale');
    expect(await cli(root, 'tldr', 'facts')).toMatchObject({ code: 0, err: '' });
    expect((await cli(root, 'tldr', 'sweep', '--json')).code).toBe(1);
  });
});

const REPO_DOCS_FIXTURE = join(import.meta.dir, 'fixtures', 'repo-docs');

/** The repo-docs fixture copied into a fresh git repository: three open specs, one complete, one archived. */
function fixtureRepo(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'repo-docs-facts-')));
  roots.push(root);
  cpSync(REPO_DOCS_FIXTURE, root, { recursive: true });
  const init = Bun.spawnSync(['git', 'init', '-q', '-b', 'main'], { cwd: root, stdout: 'pipe', stderr: 'pipe' });
  expect(init.exitCode).toBe(0);
  return root;
}

describe('tldr facts', () => {
  test('`tldr facts --json` lists exactly the open specs with their facts and writes nothing', async () => {
    const root = fixtureRepo();
    const before = snapshot(root);
    const run = await cli(root, 'tldr', 'facts', '--json');
    expect(run).toMatchObject({ code: 0, err: '' });
    const facts = JSON.parse(run.out) as { specs: Array<Record<string, unknown>> };
    expect(facts.specs.map((s) => s.number)).toEqual(['001', '002', '003']);
    expect(facts.specs.map((s) => s.title)).toEqual(['Import a recipe from a Markdown file', 'Find recipes by ingredient', 'Export the whole recipe box every night']);
    for (const spec of facts.specs) {
      expect(spec.stage).toEqual(expect.any(String));
      expect(spec.progress).toMatch(/^\d+\/\d+$/u);
      expect(spec.openClaims).toEqual(expect.any(Number));
    }
    const [one, two, three] = facts.specs;
    expect(two?.prototypes).toEqual(['002-ingredient-search/.design/prototype/index.html']);
    expect(two?.artifacts).toEqual(['002-ingredient-search/artifacts/sample-queries.md']);
    expect(one).toMatchObject({ prototypes: [], artifacts: [], fog: [] });
    expect(three).toMatchObject({ prototypes: [], artifacts: [] });
    expect(two?.fog).toEqual(['Whether a plural ("tomatoes") should match a singular ingredient line ("tomato").']);
    expect(three?.fog).toEqual(['Whether the export keeps the last seven archives or only the newest one.']);
    expect(snapshot(root)).toEqual(before);
  });
});
