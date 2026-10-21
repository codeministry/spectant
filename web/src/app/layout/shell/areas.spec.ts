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
  switchSpecLink,
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
  it('holds exactly Dashboard, Specs, Board, Planning and Library, in that order, no Tech (spec 008, ISC-129; spec 024, ISC-150.1; spec 017, ISC-157.1; spec 026, ISC-167; spec 058, ISC-394)', () => {
    expect(WORKSPACE_PAGES.map((page) => page.id)).toEqual(['dashboard', 'specs', 'board', 'planning', 'library']);
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

  it('records the bound go keys b, p (Planning, spec 026) and o (Library, spec 017 T41), none for the dashboard and specs (g s is Status)', () => {
    expect(WORKSPACE_PAGES.map((page) => page.goKey)).toEqual([null, null,'b', 'p', 'o']);
  });

  it('looks a page up by id, Library with the book icon where Tech stood', () => {
    // Spec 058 (ISC-394): the workspace dashboard, first in the menu, with the spec dashboard's icon.
    expect(workspacePageById('dashboard')).toMatchObject({ icon: 'layout-dashboard', labelKey: 'shell.pages.dashboard', summaryKey: 'shell.pages.summary.dashboard', goKey: null });
    expect(workspacePageById('board').icon).toBe('square-kanban');
    // Spec 026 (ISC-167): Planning replaces Features and Milestones in the registry.
    expect(workspacePageById('planning')).toMatchObject({ icon: 'list-tree', labelKey: 'shell.pages.planning', summaryKey: 'shell.pages.summary.planning' });
    expect(() => workspacePageById('features')).toThrow();
    expect(() => workspacePageById('milestones')).toThrow();
    expect(workspacePageById('library')).toMatchObject({ icon: 'book', labelKey: 'shell.pages.library', summaryKey: 'shell.pages.summary.library', goKey: 'o' });
  });

  it('knows the story page as a page id, but lists it in no menu entry', () => {
    for (const id of ['dashboard', 'specs', 'board', 'features', 'milestones', 'idea']) expect(isWorkspacePageId(id)).toBe(true);
    expect(isWorkspacePageId('ideas')).toBe(false);
    expect(WORKSPACE_PAGES.map((page): string => page.id)).not.toContain('idea');
  });
});

describe('workspaceLink', () => {
  it('links the dashboard to the workspace root and the others, Specs included, to their page (spec 058, ISC-394)', () => {
    expect(workspaceLink('harbor', 'dashboard')).toEqual(['/w', 'harbor']);
    expect(workspaceLink('harbor', 'specs')).toEqual(['/w', 'harbor', 'specs']);
    expect(workspaceLink('harbor', 'board')).toEqual(['/w', 'harbor', 'board']);
    expect(workspaceLink('harbor', 'features')).toEqual(['/w', 'harbor', 'features']);
    expect(workspaceLink('harbor', 'milestones')).toEqual(['/w', 'harbor', 'milestones']);
    expect(workspaceLink('harbor', 'library')).toEqual(['/w', 'harbor', 'library']);
  });
});

describe('switchSpecLink (spec 051)', () => {
  const current = TAB_IDS.filter((tab) => !(LEGACY_TAB_IDS as readonly string[]).includes(tab));

  it('keeps every current tab for the new spec (ISC-291)', () => {
    expect(current).toEqual(['status', 'timeline', 'board', 'matrix', 'claims', 'tasks', 'library', 'notes']);
    for (const tab of current) expect(switchSpecLink('harbor', '003', tab), tab).toEqual(['/w', 'harbor', 's', '003', tab]);
  });

  it('gives the new spec dashboard without a tab and for every former Docs or Evidence tab (ISC-292)', () => {
    expect(switchSpecLink('harbor', '003', null)).toEqual(['/w', 'harbor', 's', '003']);
    for (const tab of LEGACY_TAB_IDS) expect(switchSpecLink('harbor', '003', tab), tab).toEqual(['/w', 'harbor', 's', '003']);
  });
});
