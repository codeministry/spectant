import de from '../../../i18n/de.json';
import en from '../../../i18n/en.json';
import { ICON_NAMES } from '../../shared/icons/icon-names';
import { isWorkspacePageId, WORKSPACE_PAGES, workspaceLink, workspacePageById } from './areas';

/** Resolves a dotted key in a catalogue; the i18n-parity test (rule 7) covers the pairing, this covers that these keys exist. */
const lookup = (catalogue: unknown, key: string): unknown =>
  key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], catalogue);

describe('WORKSPACE_PAGES', () => {
  it('holds exactly Specs, Board, Features, Milestones and Tech, in that order (spec 008, ISC-129; spec 023, ISC-134.2)', () => {
    expect(WORKSPACE_PAGES.map((page) => page.id)).toEqual(['specs', 'board', 'features', 'milestones', 'tech']);
  });

  it('uses an icon from ICON_NAMES for every page', () => {
    for (const page of WORKSPACE_PAGES) expect(ICON_NAMES).toContain(page.icon);
  });

  it('names its label and summary keys by page id, present in both catalogues', () => {
    for (const page of WORKSPACE_PAGES) {
      expect(page.labelKey).toBe(`shell.pages.${page.id}`);
      expect(page.summaryKey).toBe(`shell.pages.summary.${page.id}`);
      for (const catalogue of [en, de]) {
        expect(typeof lookup(catalogue, page.labelKey)).toBe('string');
        expect(typeof lookup(catalogue, page.summaryKey)).toBe('string');
      }
    }
  });

  it('records go keys as candidates only: b, f and m, none for specs (g s is Status) and none for tech', () => {
    expect(WORKSPACE_PAGES.map((page) => page.goKey)).toEqual([null, 'b', 'f', 'm', null]);
  });

  it('looks a page up by id, tech included', () => {
    expect(workspacePageById('board').icon).toBe('square-kanban');
    expect(workspacePageById('features').icon).toBe('layers');
    expect(workspacePageById('milestones').icon).toBe('flag');
    expect(workspacePageById('tech')).toMatchObject({ icon: 'book-open', labelKey: 'shell.pages.tech', summaryKey: 'shell.pages.summary.tech' });
  });

  it('knows the story page as a page id, but lists it in no menu entry', () => {
    for (const id of ['specs', 'board', 'features', 'milestones', 'idea']) expect(isWorkspacePageId(id)).toBe(true);
    expect(isWorkspacePageId('ideas')).toBe(false);
    expect(WORKSPACE_PAGES.map((page): string => page.id)).not.toContain('idea');
  });
});

describe('workspaceLink', () => {
  it('links Specs to the workspace root and the others to their page', () => {
    expect(workspaceLink('harbor', 'specs')).toEqual(['/w', 'harbor']);
    expect(workspaceLink('harbor', 'board')).toEqual(['/w', 'harbor', 'board']);
    expect(workspaceLink('harbor', 'features')).toEqual(['/w', 'harbor', 'features']);
    expect(workspaceLink('harbor', 'milestones')).toEqual(['/w', 'harbor', 'milestones']);
    expect(workspaceLink('harbor', 'tech')).toEqual(['/w', 'harbor', 'tech']);
  });
});
