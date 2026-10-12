import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslocoTestingModule } from '@jsverse/transloco';
import harborTech from '../../../../../core/fixtures/harbor.tech.golden.json';
import type { TechModel, TechSpec } from '../../../../../core/src/files';
import { CATALOGUES, LANGS } from '../../../i18n/catalogues';
import { ShellState } from '../../layout/shell/shell-state.service';
import type { Tier } from '../../layout/shell/tier';
import { TechOpenTab } from './tech-open-tab';

// T18 · ISC-134.1: the Open tab against the harbor tech golden: the risks page through ui-doc-prose (a card at medium
// and wide, on the page at compact), the count line, the fog lines grouped under their spec with a status link each,
// the none-state; T23 · ISC-134.2: the muted no-risks line, without a chip, when the workspace has no specs/tech.md.

const HARBOR = harborTech as unknown as TechModel;
const spec = (id: string, fog: string[], phase = 'scoping'): TechSpec => ({
  id,
  slug: `${id}-some-spec`,
  title: `Title of ${id}`,
  type: 'feature',
  phase,
  goal: null,
  approach: null,
  fog,
});

async function render(model: TechModel, tier: Tier = 'wide'): Promise<HTMLElement> {
  TestBed.configureTestingModule({
    imports: [
      TranslocoTestingModule.forRoot({
        langs: CATALOGUES,
        translocoConfig: { availableLangs: [...LANGS], defaultLang: 'en' },
        preloadLangs: true,
      }),
    ],
    providers: [
      provideRouter([]),
      { provide: ShellState, useValue: { ws: signal('harbor'), tier: signal(tier) } },
    ],
  });
  const fixture = TestBed.createComponent(TechOpenTab);
  fixture.componentRef.setInput('model', model);
  await fixture.whenStable();
  return fixture.nativeElement as HTMLElement;
}

const text = (el: Element | null | undefined): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('TechOpenTab (T18, ISC-134.1)', () => {
  it('renders the risks page through ui-doc-prose in a card at medium and wide, without a table of contents', async () => {
    for (const tier of ['wide', 'medium'] as const) {
      TestBed.resetTestingModule();
      const root = await render(HARBOR, tier);
      const risks = root.querySelector('[data-tech-risks]');
      expect(risks?.querySelector('ui-card ui-doc-prose')).not.toBeNull();
      expect(text(risks?.querySelector('.docs-prose h2'))).toBe('Risks');
      expect(risks?.querySelectorAll('.docs-prose li').length).toBe(2);
      expect(risks?.querySelector('ui-disclosure, .docs-toc')).toBeNull();
      expect(root.querySelector('[data-tech-norisks]')).toBeNull();
    }
  });

  it('puts the risks straight on the page at compact', async () => {
    const root = await render(HARBOR, 'compact');
    const risks = root.querySelector('[data-tech-risks]');
    expect(risks?.querySelector('ui-doc-prose')).not.toBeNull();
    expect(risks?.querySelector('ui-card')).toBeNull();
  });

  it('counts the fog lines and the open specs that carry them', async () => {
    const root = await render(HARBOR);
    expect(text(root.querySelector('[data-tech-questions] h2'))).toBe('Open questions · 2 fog lines · 1 open specs');
    expect(text(root.querySelector('[data-fog-spec="005"] h3 .title'))).toBe('Decide which config format version 2 uses');
  });

  it('groups the fog lines under their spec: mono id, type glyph and title, specs without fog skipped', async () => {
    const model: TechModel = {
      ...HARBOR,
      specs: [spec('005', ['a', 'b']), spec('006', []), spec('007', ['c']), spec('008', ['d'], 'complete')],
    };
    const root = await render(model);
    const groups = [...root.querySelectorAll<HTMLElement>('[data-fog-spec]')];
    expect(groups.map((group) => group.dataset['fogSpec'])).toEqual(['005', '007']);
    const head = groups[0]?.querySelector('h3');
    expect(text(head?.querySelector('.num'))).toBe('005');
    expect(head?.querySelector('ui-type-glyph')?.getAttribute('data-type')).toBe('feature');
    // The title is TechSpec.title as core gives it; the tab looks up no dashboard row.
    expect(text(head?.querySelector('.title'))).toBe('Title of 005');
    expect(text(groups[1]?.querySelector('.title'))).toBe('Title of 007');
    expect(groups.map((group) => [...group.querySelectorAll('li a')].map((a) => (a.firstChild?.textContent ?? '').trim()))).toEqual([['a', 'b'], ['c']]);
    expect(text(root.querySelector('[data-tech-questions] h2'))).toBe('Open questions · 3 fog lines · 2 open specs');
  });

  it('makes every fog line a real link to the spec status, named "Status of <id>"', async () => {
    const root = await render(HARBOR);
    const links = [...root.querySelectorAll<HTMLAnchorElement>('[data-fog-spec] li a')];
    expect(links.length).toBe(2);
    for (const link of links) {
      expect(link.getAttribute('href')).toBe('/w/harbor/s/005/status');
      // Label in name (WCAG 2.5.3): no aria-label overrides the visible fog text; the target follows it, hidden.
      expect(link.hasAttribute('aria-label')).toBe(false);
      expect(link.querySelector('.vh')?.textContent.trim()).toBe('· Status of 005');
    }
    expect(text(links[0])).toContain('whether includes are resolved');
  });

  it('shows the none line when no open spec has fog', async () => {
    const root = await render({ ...HARBOR, specs: [spec('005', []), spec('006', [])] });
    expect(root.querySelector('[data-fog-spec]')).toBeNull();
    expect(text(root.querySelector('[data-tech-fog-none]'))).toBe('No open questions in any open spec.');
    expect(text(root.querySelector('[data-tech-questions] h2'))).toBe('Open questions · 0 fog lines · 0 open specs');
  });

  it('shows the muted no-risks line, without a command chip, above the fog list when there is no specs/tech.md (T23, ISC-134.2)', async () => {
    for (const tier of ['wide', 'compact'] as const) {
      TestBed.resetTestingModule();
      const root = await render({ ...HARBOR, pages: null }, tier);
      expect(root.querySelector('[data-tech-risks]')).toBeNull();
      const line = root.querySelector('[data-tech-norisks]');
      expect(line?.tagName).toBe('P');
      expect(line?.classList.contains('no-risks')).toBe(true);
      expect(text(line)).toBe('Risks come from specs/tech.md.');
      expect(line?.nextElementSibling?.hasAttribute('data-tech-questions')).toBe(true);
      expect(root.querySelector('ui-command-chip, ui-empty-state, ui-notice')).toBeNull();
      expect(root.querySelectorAll('[data-fog-spec] li').length).toBe(2);
    }
  });
});
