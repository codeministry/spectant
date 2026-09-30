import de from '../../../i18n/de.json';
import en from '../../../i18n/en.json';
import { ICON_NAMES } from '../../shared/icons/icon-names';
import { WORKSPACE_PAGES, workspaceLink, workspacePageById } from './areas';

/** Resolves a dotted key in a catalogue; the i18n-parity test (rule 7) covers the pairing, this covers that these keys exist. */
const lookup = (catalogue: unknown, key: string): unknown =>
  key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], catalogue);

describe('WORKSPACE_PAGES', () => {
  it('holds exactly Specs, Features and Milestones, in that order', () => {
    expect(WORKSPACE_PAGES.map((page) => page.id)).toEqual(['specs', 'features', 'milestones']);
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

  it('records go keys as candidates only: f and m, none for specs (g s is Status)', () => {
    expect(WORKSPACE_PAGES.map((page) => page.goKey)).toEqual([null, 'f', 'm']);
  });

  it('looks a page up by id', () => {
    expect(workspacePageById('features').icon).toBe('layers');
    expect(workspacePageById('milestones').icon).toBe('flag');
  });
});

describe('workspaceLink', () => {
  it('links Specs to the workspace root and the others to their page', () => {
    expect(workspaceLink('harbor', 'specs')).toEqual(['/w', 'harbor']);
    expect(workspaceLink('harbor', 'features')).toEqual(['/w', 'harbor', 'features']);
    expect(workspaceLink('harbor', 'milestones')).toEqual(['/w', 'harbor', 'milestones']);
  });
});
