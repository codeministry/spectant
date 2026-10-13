import type { DemoLibraryEntry } from '../../shared/demo/demo-data';
import { highlight, isImage, matches, NO_FILTER, related, sharedRefs, snippet, specSlug, specsOf } from './library-model';

const entry = (id: string, over: Partial<DemoLibraryEntry> = {}): DemoLibraryEntry => ({
  id,
  spec: '002',
  type: 'plan',
  title: `Title ${id}`,
  file: 'specs/002-web-console/plan.md',
  updated: '2026-03-06T11:10:00Z',
  refs: [],
  body: '## Approach\nThe **dashboard** is a pure function of the files.',
  ...over,
});

describe('library model', () => {
  it('matches title, body and references ignoring case, and applies type, spec and stale filters', () => {
    const doc = entry('a', { refs: ['ETag'], stale: 'old' });
    expect(matches(doc, { ...NO_FILTER, query: 'title A' })).toBe(true);
    expect(matches(doc, { ...NO_FILTER, query: 'pure function' })).toBe(true);
    expect(matches(doc, { ...NO_FILTER, query: 'etag' })).toBe(true);
    expect(matches(doc, { ...NO_FILTER, query: 'nowhere' })).toBe(false);
    expect(matches(doc, { ...NO_FILTER, type: 'design' })).toBe(false);
    expect(matches(doc, { ...NO_FILTER, spec: 'ws' })).toBe(false);
    expect(matches(entry('b'), { ...NO_FILTER, stale: true })).toBe(false);
    expect(matches(doc, { ...NO_FILTER, stale: true })).toBe(true);
  });

  it('relates documents that share a reference, and names the shared ones', () => {
    const a = entry('a', { refs: ['ETag', 'lanes'] });
    const b = entry('b', { refs: ['lanes'] });
    const c = entry('c', { refs: ['other'] });
    expect(related(a, [a, b, c]).map((doc) => doc.id)).toEqual(['b']);
    expect(sharedRefs(a, b)).toEqual(['lanes']);
  });

  it('highlights the first match and cuts the snippet around it', () => {
    expect(highlight('Approach & architecture', 'ARCH')).toEqual([
      { text: 'Approach & ', hit: false },
      { text: 'arch', hit: true },
      { text: 'itecture', hit: false },
    ]);
    expect(highlight('Plan', '')).toEqual([{ text: 'Plan', hit: false }]);
    expect(snippet('## A\n**b** c', '')).toEqual([{ text: 'A b c', hit: false }]);
    const long = `${'x '.repeat(40)}needle ${'y '.repeat(40)}`;
    const runs = snippet(long, 'needle');
    expect(runs[0]).toEqual({ text: '…', hit: false });
    expect(runs.find((run) => run.hit)?.text).toBe('needle');
    expect(runs.at(-1)).toEqual({ text: '…', hit: false });
  });

  it('reads the slug from the path, the specs in order and image files', () => {
    expect(specSlug(entry('a'))).toBe('web-console');
    expect(specSlug(entry('a', { file: 'specs/constitution.md' }))).toBeNull();
    expect(specsOf([entry('a'), entry('b', { spec: 'ws' }), entry('c')])).toEqual(['002', 'ws']);
    expect(isImage(entry('a', { file: '.evidence/kpi-band-390.png' }))).toBe(true);
    expect(isImage(entry('a'))).toBe(false);
  });
});
