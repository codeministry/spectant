// The text planners behind the plugin CLI (spec 031, T7 for ISC-41): a new spec folder, claims minted in the master
// first and then projected into the spec, a Verification line and a Decisions row. Round trip: every text they return
// parses back through core's own readers without a diagnostic, and the pair master + new spec reports no drift.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseClaims } from '../src/claims.ts';
import { parseEvents } from '../src/events.ts';
import { parseFrontmatter } from '../src/frontmatter.ts';
import * as barrel from '../src/index.ts';
import {
  appendDecisionText,
  appendVerificationText,
  mintClaimsText,
  projectClaimsText,
  specFolderText,
  SpecTextError,
  type SpecTextRow,
} from '../src/spec-text.ts';
import { driftReport, hasDrift, masterProgressMismatch } from '../src/status.ts';

const HARBOR_MASTER = readFileSync(join(import.meta.dir, '..', 'fixtures', 'harbor', 'ISA.md'), 'utf8');
const NOW = new Date('2026-04-01T09:00:00Z');
const LATER = new Date('2026-04-02T10:30:00Z');
const ACTOR = 'u:3f9c0a7d';

const CLAIMS = [
  { text: 'A webhook from an upstream registry starts a sync of the tag it names within one minute.' },
  { text: 'Anti: a webhook with a wrong signature starts a sync.', after: ['ISC-132'] },
];
const ROWS: SpecTextRow[] = [
  { type: 'bun-test', check: 'sync started after a webhook', threshold: '≤ 60 s', tool: '`bun test tests/webhook.test.ts -t "start"`', anchorsTo: 'literal' },
  { type: 'bun-test', check: 'syncs started by a forged webhook', threshold: '0', tool: '`bun test tests/webhook.test.ts -t "forged"`', anchorsTo: 'derived: no-leak', severity: 'high' },
];

function planned() {
  return specFolderText({
    type: 'feature',
    number: 10,
    slug: 'registry-webhooks',
    title: 'React to upstream tag moves through registry webhooks',
    goal: 'A mirror follows an upstream tag within a minute of the move, without waiting for the next scheduled run.',
    feature: 'F7',
    now: NOW,
    actor: ACTOR,
  });
}

describe('specFolderText', () => {
  test('plans specs/NNN-slug with spec.md, context.md and events.jsonl', () => {
    const folder = planned();
    expect(folder.dir).toBe('specs/010-registry-webhooks');
    expect(Object.keys(folder.files).sort()).toEqual(['context.md', 'events.jsonl', 'spec.md']);
  });

  test('spec.md parses with no diagnostic and carries the frontmatter FORMAT.md describes', () => {
    const spec = planned().files['spec.md'];
    const fm = parseFrontmatter(spec);
    expect(fm.diagnostics).toEqual([]);
    expect(fm.data.slug).toBe('010-registry-webhooks');
    expect(fm.data.specType).toBe('feature');
    expect(fm.data.isaMaster).toBe('../../ISA.md');
    expect(fm.data.isaFeature).toBe('F7');
    expect(fm.data.phase).toBe('scoping');
    expect(fm.data.progress).toEqual({ closed: 0, total: 0 });
    expect(fm.data.started).toBe(NOW.toISOString());
    expect(fm.data.updated).toBe(NOW.toISOString());
    expect(fm.data.contextLog).toBe('context.md');
    const doc = parseClaims(spec);
    expect(doc.diagnostics).toEqual([]);
    expect(doc.section?.heading).toBe('Claims');
    expect(doc.claims).toEqual([]);
    const headings = spec.split('\n').filter((l) => l.startsWith('## ')).map((l) => l.slice(3));
    expect(headings).toEqual(['Problem', 'Vision', 'Out of Scope', 'Constraints', 'Goal', 'Not yet specified', 'Claims', 'Test Strategy', 'Decisions', 'Verification']);
    expect(spec).toContain('| isc | type | check | threshold | tool | anchors_to | severity |');
  });

  test('events.jsonl holds the one creation event core accepts', () => {
    const { events, diagnostics } = parseEvents(planned().files['events.jsonl']);
    expect(diagnostics).toEqual([]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ ts: NOW.toISOString(), from: null, to: 'plan', actor: ACTOR });
  });

  test('a bug folder carries the light sections only', () => {
    const spec = specFolderText({ type: 'bug', number: 11, slug: 'lost-tag', title: 'Lost tag', goal: 'g', now: NOW, actor: ACTOR }).files['spec.md'];
    const headings = spec.split('\n').filter((l) => l.startsWith('## ')).map((l) => l.slice(3));
    expect(headings).toEqual(['Problem', 'Goal', 'Claims', 'Test Strategy', 'Decisions', 'Verification']);
    expect(parseFrontmatter(spec).data.isaFeature).toBeNull();
  });
});

describe('mintClaimsText', () => {
  test('mints the next free IDs into the feature block and its rows into the Test Strategy', () => {
    const { text, ids } = mintClaimsText(HARBOR_MASTER, 'F7', CLAIMS, ROWS);
    expect(ids).toEqual(['ISC-132', 'ISC-133']);
    const doc = parseClaims(text);
    expect(doc.diagnostics).toEqual([]);
    expect(doc.features.find((f) => f.id === 'F7')?.claims).toEqual(ids);
    const minted = doc.claims.filter((c) => ids.includes(c.id));
    expect(minted.map((c) => [c.id, c.checked, c.kind, c.after])).toEqual([
      ['ISC-132', false, 'normal', []],
      ['ISC-133', false, 'anti', ['ISC-132']],
    ]);
    expect(doc.testStrategy.slice(-2).map((r) => [r.isc, r.type, r.anchorsTo, r.severity, r.cells])).toEqual([
      ['ISC-132', 'bun-test', 'literal', '', 7],
      ['ISC-133', 'bun-test', 'derived: no-leak', 'high', 7],
    ]);
    expect(masterProgressMismatch(parseFrontmatter(text), doc)).toBeNull();
    // Nothing else moves: removing the inserted lines gives the master back, the progress line aside.
    const strip = (t: string) => t.split('\n').filter((l) => !/ISC-13[23]\b/.test(l) && !l.startsWith('progress:')).join('\n');
    expect(strip(text).replace(/\n{3,}/g, '\n\n')).toBe(strip(HARBOR_MASTER).replace(/\n{3,}/g, '\n\n'));
  });

  test('a tombstoned ID is never reused; IDs in prose, backticks and Verification do not count', () => {
    const master = [
      '---',
      'progress: 0/1',
      '---',
      '',
      '## Claims',
      '',
      '- [ ] ISC-9: [DROPPED — see Decisions] An old promise.',
      '- [ ] ISC-4: Something `ISC-70` names.',
      '',
      '## Decisions',
      '',
      '- ISC-50 was discussed and never minted.',
      '',
      '## Verification',
      '',
      '- ISC-60: an orphan line',
      '',
    ].join('\n');
    const { text, ids } = mintClaimsText(master, 'F1', [{ text: 'New one.' }], [ROWS[0]]);
    expect(ids).toEqual(['ISC-10']);
    const doc = parseClaims(text);
    expect(doc.claims.map((c) => c.id)).toEqual(['ISC-9', 'ISC-4', 'ISC-10']);
    expect(doc.testStrategy.map((r) => r.isc)).toEqual(['ISC-10']);
    expect(parseFrontmatter(text).data.progress).toEqual({ closed: 0, total: 2 });
  });

  test('an unknown feature block in a master with feature blocks is refused', () => {
    expect(() => mintClaimsText(HARBOR_MASTER, 'F99', CLAIMS, ROWS)).toThrow(SpecTextError);
  });
});

describe('projectClaimsText and the drift check', () => {
  test('master first, then the spec: driftReport reports no drift', () => {
    const minted = mintClaimsText(HARBOR_MASTER, 'F7', CLAIMS, ROWS);
    const projected = CLAIMS.map((c, i) => ({ ...c, id: minted.ids[i] as string }));
    const spec = projectClaimsText(planned().files['spec.md'], projected, ROWS);
    const doc = parseClaims(spec);
    expect(doc.diagnostics).toEqual([]);
    expect(doc.claims.map((c) => c.id)).toEqual(['ISC-132', 'ISC-133']);
    expect(doc.testStrategy.map((r) => r.isc)).toEqual(['ISC-132', 'ISC-133']);
    const fm = parseFrontmatter(spec);
    expect(fm.data.progress).toEqual({ closed: 0, total: 2 });
    const report = driftReport({ frontmatter: fm, spec: doc, master: parseClaims(minted.text) });
    expect(hasDrift(report)).toBe(false);
  });

  test('appendVerificationText ticks, appends the evidence line and recounts in spec and master alike', () => {
    const minted = mintClaimsText(HARBOR_MASTER, 'F7', CLAIMS, ROWS);
    const projected = CLAIMS.map((c, i) => ({ ...c, id: minted.ids[i] as string }));
    const spec0 = projectClaimsText(planned().files['spec.md'], projected, ROWS);
    const spec = appendVerificationText(spec0, 'ISC-132', 'bun-test', '`bun test tests/webhook.test.ts -t "start"` passed', LATER);
    const master = appendVerificationText(minted.text, 'ISC-132', 'bun-test', '`bun test tests/webhook.test.ts -t "start"` passed', LATER);
    const doc = parseClaims(spec);
    expect(doc.claims.find((c) => c.id === 'ISC-132')?.checked).toBe(true);
    expect(doc.verification.map((v) => [v.id, v.text])).toEqual([['ISC-132', 'bun-test — `bun test tests/webhook.test.ts -t "start"` passed']]);
    const fm = parseFrontmatter(spec);
    expect(fm.data.progress).toEqual({ closed: 1, total: 2 });
    expect(fm.data.updated).toBe(LATER.toISOString());
    expect(parseClaims(master).verification.at(-1)?.id).toBe('ISC-132');
    expect(parseFrontmatter(master).data.updated).toBe(LATER.toISOString());
    expect(hasDrift(driftReport({ frontmatter: fm, spec: doc, master: parseClaims(master) }))).toBe(false);
  });

  test('a Verification section is created when the file has none', () => {
    const text = ['---', 'progress: 0/1', '---', '', '## Claims', '', '- [ ] ISC-1: One.', '', '## Decisions', '', '- 2026-01-01: d', ''].join('\n');
    const out = appendVerificationText(text, 'ISC-1', 'bash', 'exit 0', LATER);
    expect(out.split('\n').filter((l) => l.startsWith('## '))).toEqual(['## Claims', '## Decisions', '## Verification']);
    expect(parseClaims(out).verification.map((v) => v.id)).toEqual(['ISC-1']);
  });

  test('a multi-line stub or an unknown ID is refused with a typed error', () => {
    const spec = projectClaimsText(planned().files['spec.md'], [{ id: 'ISC-132', text: 'One.' }], [ROWS[0]]);
    expect(() => appendVerificationText(spec, 'ISC-132', 'bun-test', 'line one\nline two', LATER)).toThrow(SpecTextError);
    expect(() => appendVerificationText(spec, 'ISC-999', 'bun-test', 'ok', LATER)).toThrow(SpecTextError);
    try {
      appendVerificationText(spec, 'ISC-132', 'bun-test', 'a\nb', LATER);
    } catch (error) {
      expect((error as SpecTextError).code).toBe('multi-line');
    }
  });
});

describe('appendDecisionText', () => {
  test('appends one dated line at the end of ## Decisions', () => {
    const spec = appendDecisionText(planned().files['spec.md'], 'webhooks are verified by HMAC, not by source address', LATER);
    const lines = spec.split('\n');
    const at = lines.indexOf('## Decisions');
    const next = lines.findIndex((l, i) => i > at && l.startsWith('## '));
    expect(lines.slice(at, next).filter((l) => l.startsWith('- '))).toEqual(['- 2026-04-02: webhooks are verified by HMAC, not by source address']);
  });
});

describe('the barrel', () => {
  test('exports the planners', () => {
    expect(typeof barrel.specFolderText).toBe('function');
    expect(typeof barrel.mintClaimsText).toBe('function');
    expect(typeof barrel.projectClaimsText).toBe('function');
    expect(typeof barrel.appendVerificationText).toBe('function');
    expect(typeof barrel.appendDecisionText).toBe('function');
  });
});
