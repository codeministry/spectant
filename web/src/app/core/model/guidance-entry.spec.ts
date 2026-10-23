import { describe, expect, it } from 'vitest';
import type { Guidance, GuidanceEntry, ItemStateInfo } from '../../../../../core/src/files';
import { guidanceEntryOf, guidanceOfBody, waitingEntries, withReason } from './guidance-entry';

// Spec 020 (T13, ISC-237.1): every surface finds its spec's own entry here, so the same item reads the same sentence.
const entry = (spec: string, item: GuidanceEntry['item'], key: string, ref: string | null = null): GuidanceEntry => ({
  spec,
  item,
  ref,
  title: `spec ${spec}`,
  command: `/spec implement ${spec}`,
  priority: 'P2',
  since: null,
  reason: { key, values: {}, phrase: `${key} of ${spec}` },
});

const GUIDANCE: Guidance = {
  waits: [entry('002', 'claim', 'waiting.manual', 'ISC-77'), entry('006', 'spec', 'stage.review.0')],
  next: [entry('002', 'spec', 'stage.build.0'), entry('003', 'spec', 'stage.tasks.0')],
};

describe('guidanceEntryOf', () => {
  it('finds the spec item of a spec in waits and in next, never a claim, task or question entry', () => {
    expect(guidanceEntryOf(GUIDANCE, '006')?.reason.key).toBe('stage.review.0');
    expect(guidanceEntryOf(GUIDANCE, '002')?.reason.key).toBe('stage.build.0');
    expect(guidanceEntryOf(GUIDANCE, '003')?.item).toBe('spec');
  });

  it('finds a spec item folded under its spec\'s front entry (spec 070, ISC-568), before the next list', () => {
    const own = entry('005', 'spec', 'stage.review.0');
    const folded: Guidance = {
      waits: [{ ...entry('005', 'claim', 'waiting.manual', 'ISC-94'), folded: [entry('005', 'task', 'waiting.operator', 'T40'), own] }],
      next: [entry('005', 'spec', 'stage.build.0')],
    };
    expect(guidanceEntryOf(folded, '005')).toBe(own);
    expect(guidanceEntryOf(folded, '004')).toBeNull();
  });

  it('is null for a spec without an entry, without guidance or without a spec id', () => {
    expect(guidanceEntryOf(GUIDANCE, '008')).toBeNull();
    expect(guidanceEntryOf(undefined, '006')).toBeNull();
    expect(guidanceEntryOf(null, '006')).toBeNull();
    expect(guidanceEntryOf(GUIDANCE, undefined)).toBeNull();
  });
});

describe('waitingEntries', () => {
  it('unfolds each front entry\'s folded entries behind it, in their order; an unfolded list stays as it is', () => {
    const t31 = entry('002', 'task', 'waiting.operator', 'T31');
    const t29 = entry('002', 'question', 'waiting.question', 'T29');
    const front = { ...entry('002', 'claim', 'waiting.manual', 'ISC-77'), folded: [t31, t29] };
    const spec = entry('006', 'spec', 'stage.review.0');
    expect(waitingEntries([spec, front])).toEqual([spec, front, t31, t29]);
    expect(waitingEntries(GUIDANCE.waits)).toEqual(GUIDANCE.waits);
    expect(waitingEntries([])).toEqual([]);
  });
});

describe('guidanceOfBody', () => {
  it('passes a served body guidance through as it is', () => {
    expect(guidanceOfBody({ specs: [], guidance: GUIDANCE })).toBe(GUIDANCE);
  });

  it('is undefined for a body without guidance or with a malformed one', () => {
    expect(guidanceOfBody({ specs: [] })).toBeUndefined();
    expect(guidanceOfBody({ guidance: { waits: [] } })).toBeUndefined();
    expect(guidanceOfBody(null)).toBeUndefined();
  });
});

describe('withReason', () => {
  const info: ItemStateInfo = { kind: 'spec', id: '006', state: 'open', stage: 'review', command: '/spec review 006', reason: 'the reviewed mark is stale' };

  it('replaces the reason with the sentence', () => {
    expect(withReason(info, 'Read the spec and confirm it.')).toEqual({ ...info, reason: 'Read the spec and confirm it.' });
  });

  it('keeps the same object without a sentence, with the same text or without a reason', () => {
    expect(withReason(info, '')).toBe(info);
    expect(withReason(info, null)).toBe(info);
    expect(withReason(info, info.reason)).toBe(info);
    const bare: ItemStateInfo = { kind: 'spec', id: '006', state: 'open', stage: 'review' };
    expect(withReason(bare, 'x')).toBe(bare);
  });
});
