// Spec 009, the token baseline: `tokenRows` over the hand-written transcript fixture and harbor's specs, serialised,
// equals the hand-computed golden `core/tests/fixtures/tokens.golden.jsonl` byte for byte (ISC-135, group `rows`).
//
// The test does the reading, as `spectant tokens` (server/src/tokens-cli.ts) does it for a real repository: the main
// sessions `<session>.jsonl`, the sub-agents `<session>/subagents/agent-<id>.jsonl` with the `toolUseId` of their
// `.meta.json`, the sessions of the sibling agent-worktree folders, and per spec folder its `events.jsonl` and
// `rounds.jsonl` texts plus the stage the dashboard model derives for it. `core/src/tokens.ts` reads no file.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';

import { buildDashboard } from '../src/dashboard.ts';
import { type TokenInput, type TokenSpecInput, type TranscriptFile, serializeTokens, tokenRows } from '../src/tokens.ts';
import { readTree } from './helpers/read-tree.ts';

const TRANSCRIPTS = join(import.meta.dir, 'fixtures', 'transcripts');
const PROJECT = 'harbor';
const WORKTREE_INFIX = '--claude-worktrees-agent-';
const GOLDEN = join(import.meta.dir, 'fixtures', 'tokens.golden.jsonl');

const byteOrder = (a: string, b: string): number => Buffer.compare(Buffer.from(a), Buffer.from(b));
const sortedNames = (dir: string): string[] => readdirSync(dir).sort(byteOrder);

function toolUseIdOf(path: string): string | null {
  if (!existsSync(path)) return null;
  const meta: unknown = JSON.parse(readFileSync(path, 'utf8'));
  const id = typeof meta === 'object' && meta !== null ? (meta as { toolUseId?: unknown }).toolUseId : undefined;
  return typeof id === 'string' && id !== '' ? id : null;
}

/** Every transcript of the project folder and its agent-worktree siblings, as the CLI's discovery lists them. */
function transcriptsOf(root: string, project: string): TranscriptFile[] {
  const folder = join(root, project);
  const files: TranscriptFile[] = [];
  for (const name of sortedNames(folder)) {
    if (name.endsWith('.jsonl')) {
      files.push({ role: 'main', session: name.slice(0, -'.jsonl'.length), label: name, text: readFileSync(join(folder, name), 'utf8') });
      continue;
    }
    const subagents = join(folder, name, 'subagents');
    if (!existsSync(subagents)) continue;
    for (const file of sortedNames(subagents)) {
      const match = /^(agent-.+)\.jsonl$/.exec(file);
      if (match === null) continue;
      files.push({
        role: 'subagent',
        session: name,
        label: `${name}/subagents/${file}`,
        text: readFileSync(join(subagents, file), 'utf8'),
        toolUseId: toolUseIdOf(join(subagents, `${match[1] ?? ''}.meta.json`)),
      });
    }
  }
  for (const sibling of sortedNames(root)) {
    if (!sibling.startsWith(`${project}${WORKTREE_INFIX}`)) continue;
    for (const name of sortedNames(join(root, sibling))) {
      if (!name.endsWith('.jsonl')) continue;
      const label = `../${sibling}/${name}`;
      files.push({ role: 'worktree', session: name.slice(0, -'.jsonl'.length), label, text: readFileSync(join(root, sibling, name), 'utf8') });
    }
  }
  return files;
}

/** harbor's spec folders as the CLI hands them to core: texts as read, derived stage from the dashboard model. */
function harborSpecs(): TokenSpecInput[] {
  const input = readTree('harbor');
  const stages = new Map(buildDashboard({ ...input, services: [] }).specs.map((row) => [row.slug, row.stage]));
  return [...input.specs, ...input.archived]
    .map((files) => ({
      slug: files.folder,
      events: files.texts.events ?? null,
      rounds: files.texts.rounds ?? null,
      derivedStage: stages.get(files.folder) ?? null,
    }))
    .sort((a, b) => byteOrder(a.slug, b.slug));
}

const fixtureInput = (): TokenInput => ({ transcripts: transcriptsOf(TRANSCRIPTS, PROJECT), specs: harborSpecs() });

describe('rows', () => {
  test('the fixture is read as three transcripts: sub-agent with its toolUseId, main session, worktree session', () => {
    const files = transcriptsOf(TRANSCRIPTS, PROJECT);
    expect(files.map((f) => f.role)).toEqual(['subagent', 'main', 'worktree']);
    expect(files[0]?.toolUseId).toBe('toolu_01HarborI1');
  });

  test('a measuring run over the fixture transcript yields exactly the golden lines', () => {
    const run = tokenRows(fixtureInput());
    expect(run.baseline).not.toBeNull();
    const built = serializeTokens([...(run.baseline === null ? [] : [run.baseline]), ...run.rows]);
    expect(built.split('\n')).toEqual(readFileSync(GOLDEN, 'utf8').split('\n'));
    expect(built).toBe(readFileSync(GOLDEN, 'utf8'));
  });

  test('the result does not depend on the order of the transcripts', () => {
    const input = fixtureInput();
    const reversed: TokenInput = { ...input, transcripts: [...input.transcripts].reverse() };
    const run = tokenRows(reversed);
    const built = serializeTokens([...(run.baseline === null ? [] : [run.baseline]), ...run.rows]);
    expect(built).toBe(readFileSync(GOLDEN, 'utf8'));
  });
});
