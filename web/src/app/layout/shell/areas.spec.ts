import de from '../../../i18n/de.json';
import en from '../../../i18n/en.json';
import { ICON_NAMES } from '../../shared/icons/icon-names';
import {
  areaById,
  areaOfTab,
  areaPath,
  isWorkspacePageId,
  LEGACY_TAB_IDS,
  SPEC_AREAS,
  TAB_IDS,
  WORKSPACE_PAGES,
  workspaceLink,
  workspacePageById,
} from './areas';

/** Resolves a dotted key in a catalogue; the i18n-parity test (rule 7) covers the pairing, this covers that these keys exist. */
const lookup = (catalogue: unknown, key: string): unknown =>
  key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], catalogue);

describe('SPEC_AREAS (spec 017, T45, ISC-158)', () => {
  it('holds exactly Dashboard, Status, Live, Data, Library and Notes, in that order, no Docs', () => {
    expect(SPEC_AREAS.map((area) => area.id)).toEqual(['dashboard', 'status', 'live', 'data', 'library', 'notes']);
  });

  it('gives Data exactly Claims and Tasks, and the Library one tab at …/library with book, g o, its bar and no rail', () => {
    expect(areaById('data').tabs).toEqual(['claims', 'tasks']);
    expect(areaById('library')).toMatchObject({ tabs: ['library'], icon: 'book', goKey: 'o', built: true, singleTabBar: true, noRail: true });
    expect(areaPath(areaById('library'))).toBe('library');
    expect(SPEC_AREAS.filter((area) => area.noRail === true || area.singleTabBar === true).map((area) => area.id)).toEqual(['library']);
  });

  it('lists no former Docs or Evidence tab in an area, and counts their routes as the Library until T48', () => {
    const listed = SPEC_AREAS.flatMap((area) => area.tabs);
    for (const tab of LEGACY_TAB_IDS) {
      expect(listed, tab).not.toContain(tab);
      expect(TAB_IDS, tab).toContain(tab);
      expect(areaOfTab(tab).id, tab).toBe('library');
    }
    expect(areaOfTab('tasks').id).toBe('data');
  });

  it('names every area and tab in both catalogues; the Library tab reads Documents', () => {
    for (const catalogue of [en, de]) {
      for (const area of SPEC_AREAS) {
        expect(typeof lookup(catalogue, `shell.areas.${area.id}`), area.id).toBe('string');
        expect(typeof lookup(catalogue, `shell.area.summary.${area.id}`), area.id).toBe('string');
        for (const tab of area.tabs) expect(typeof lookup(catalogue, `shell.tabs.${tab}`), tab).toBe('string');
      }
    }
    expect(lookup(en, 'shell.tabs.library')).toBe('Documents');
    expect(lookup(de, 'shell.tabs.library')).toBe('Dokumente');
    expect(lookup(en, 'shell.areas.library')).toBe('Library');
  });
});

describe('WORKSPACE_PAGES', () => {
  it('holds exactly Specs, Board, Features, Milestones and Library, in that order, no Tech (spec 008, ISC-129; spec 024, ISC-150.1; spec 017, ISC-157.1)', () => {
    expect(WORKSPACE_PAGES.map((page) => page.id)).toEqual(['specs', 'board', 'features', 'milestones', 'library']);
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

  it('records the bound go keys b, f, m and o (Library, spec 017 T41), none for specs (g s is Status)', () => {
    expect(WORKSPACE_PAGES.map((page) => page.goKey)).toEqual([null, 'b', 'f', 'm', 'o']);
  });

  it('looks a page up by id, Library with the book icon where Tech stood', () => {
    expect(workspacePageById('board').icon).toBe('square-kanban');
    expect(workspacePageById('features').icon).toBe('layers');
    expect(workspacePageById('milestones').icon).toBe('flag');
    expect(workspacePageById('library')).toMatchObject({ icon: 'book', labelKey: 'shell.pages.library', summaryKey: 'shell.pages.summary.library', goKey: 'o' });
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
    expect(workspaceLink('harbor', 'library')).toEqual(['/w', 'harbor', 'library']);
  });
});
