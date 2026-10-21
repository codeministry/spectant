import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslocoTestingModule } from '@jsverse/transloco';
import harbor from '../../../../../../core/fixtures/harbor.golden.json';
import lantern from '../../../../../../core/fixtures/lantern.golden.json';
import type { DashboardView as DashboardModel } from '../context-rail/dashboard-view';
import { CATALOGUES, LANGS } from '../../../../i18n/catalogues';
import { type WarningsForm, WarningsPanel } from './warnings-panel';

const HARBOR = harbor as unknown as DashboardModel;
const LANTERN = lantern as unknown as DashboardModel;

beforeEach(() => {
  TestBed.configureTestingModule({
    imports: [
      TranslocoTestingModule.forRoot({
        langs: CATALOGUES,
        translocoConfig: { availableLangs: [...LANGS], defaultLang: 'en' },
        preloadLangs: true,
      }),
    ],
    providers: [provideRouter([])],
  });
});

/** Mounts the panel; `open` is set only when given (spec 064: the section form starts folded). */
async function mount(model: DashboardModel, form?: WarningsForm, open?: boolean) {
  const fixture = TestBed.createComponent(WarningsPanel);
  fixture.componentRef.setInput('specs', model.specs);
  fixture.componentRef.setInput('kpis', model.kpis);
  if (form) fixture.componentRef.setInput('form', form);
  if (open !== undefined) fixture.componentRef.setInput('open', open);
  await fixture.whenStable();
  return fixture;
}

/** The panel's element, the section form unfolded so its list renders. */
async function render(model: DashboardModel, form?: WarningsForm, open = true): Promise<HTMLElement> {
  return (await mount(model, form, open)).nativeElement as HTMLElement;
}

const withWarnings = (model: DashboardModel) => model.specs.filter((r) => r.warnings.length > 0);
/** The prototype's groups: every spec with a warning or open fog, in model order. */
const withNotes = (model: DashboardModel) => model.specs.filter((r) => r.warnings.length > 0 || r.fog > 0);

describe('WarningsPanel', () => {
  // Open fog is said once, by the spec's fog line: a fog-kind warning of a spec with open fog gets no text line.
  const said = (spec: (typeof HARBOR.specs)[number]) => spec.warnings.filter((w) => !(spec.fog > 0 && w.kind === 'fog'));

  it('groups the lines by spec in model order, one line per model warning, under a focusable heading', async () => {
    const root = await render(HARBOR);
    const heading = root.querySelector('#warnings') as HTMLElement;
    expect(heading.tagName).toBe('H2');
    expect(heading.querySelector('[data-warnings-title]')?.textContent.trim()).toBe('Warnings');
    expect(heading.getAttribute('tabindex')).toBe('-1');

    const groups = [...root.querySelectorAll('[data-warning-spec]')];
    expect(groups.map((g) => g.getAttribute('data-warning-spec'))).toEqual(withNotes(HARBOR).map((r) => r.id));
    for (const spec of withWarnings(HARBOR)) {
      const group = root.querySelector(`[data-warning-spec="${spec.id}"]`) as HTMLElement;
      const lines = [...group.querySelectorAll('[data-warning-kind]')];
      expect(lines.map((i) => i.getAttribute('data-warning-kind'))).toEqual(said(spec).map((w) => w.kind));
      said(spec).forEach((w, i) => {
        const line = lines[i] as HTMLElement;
        expect(line.querySelector('ui-icon[data-icon="triangle-alert"]')).not.toBeNull();
        const link = line.querySelector('a[data-warning-link]') as HTMLAnchorElement;
        expect(link.getAttribute('href')).toBe(`/?sel=spec:${spec.id}`);
        expect(link.textContent.trim()).toBe(spec.id);
        expect(line.querySelector('[data-warning-text]')?.textContent.trim()).toBe(w.text);
        expect(line.querySelector('ui-command-chip code')?.textContent ?? null).toBe(w.command ?? w.overlap?.edge ?? null);
      });
    }
  });

  it('adds one fog line per spec with open fog: cloud icon, spec link and the count', async () => {
    const root = await render(HARBOR);
    const foggy = HARBOR.specs.filter((r) => r.fog > 0);
    expect(foggy.length).toBeGreaterThan(0);
    const lines = [...root.querySelectorAll('[data-fog-line]')];
    expect(lines.map((l) => l.getAttribute('data-fog-line'))).toEqual(foggy.map((r) => r.id));
    for (const spec of foggy) {
      const line = root.querySelector(`[data-fog-line="${spec.id}"]`) as HTMLElement;
      expect(line.closest(`[data-warning-spec="${spec.id}"]`)).not.toBeNull();
      // spec 024: prototype value (principal: the prototype wins)
      expect(line.querySelector('ui-icon[data-icon="cloud"]')).not.toBeNull();
      expect(line.querySelector('a[data-warning-link]')?.getAttribute('href')).toBe(`/?sel=spec:${spec.id}`);
      expect(line.textContent).toContain(spec.fog === 1 ? '1 open fog item' : `${spec.fog} open fog items`);
    }
    expect(root.querySelector('[data-open-fog]')).toBeNull();
  });

  it("states the model's warning count and the specs they sit in", async () => {
    const root = await render(HARBOR, 'callout');
    const specs = withWarnings(HARBOR).length;
    expect(root.querySelector('[data-warnings-summary]')?.textContent.trim()).toBe(`${HARBOR.kpis.warnings} warnings in ${specs} specs`);
  });

  it('shows the "No warnings" line with a check icon and no fog line when the model has none', async () => {
    const root = await render(LANTERN);
    expect(root.querySelectorAll('[data-warning-spec]').length).toBe(0);
    const empty = root.querySelector('[data-warnings-empty]') as HTMLElement;
    expect(empty.textContent.trim()).toBe('No warnings');
    expect(empty.querySelector('ui-icon')).not.toBeNull();
    expect(root.querySelector('[data-fog-line]')).toBeNull();
  });

  it('renders the section form by default: the heading with the count above one card of lines', async () => {
    const root = await render(HARBOR);
    expect(root.getAttribute('data-form')).toBe('section');
    const header = root.querySelector('section > h2#warnings') as HTMLElement;
    expect(header.querySelector('[data-warnings-count]')?.textContent.trim()).toBe(String(HARBOR.kpis.warnings));
    const cards = root.querySelectorAll('ui-card');
    expect(cards.length).toBe(1);
    expect((cards[0] as HTMLElement).querySelectorAll('[data-warning-spec]').length).toBe(withNotes(HARBOR).length);
  });

  it('renders the callout form as a collapsed details element summarising the count', async () => {
    const root = await render(HARBOR, 'callout');
    const details = root.querySelector('details[data-warnings-callout]') as HTMLDetailsElement;
    expect(details.open).toBe(false);
    const summary = details.querySelector('summary') as HTMLElement;
    expect(summary.id).toBe('warnings');
    expect(summary.textContent).toContain(`${HARBOR.kpis.warnings} warnings in ${withWarnings(HARBOR).length} specs`);
    expect(details.querySelectorAll('[data-warning-spec]').length).toBe(withNotes(HARBOR).length);
  });

  it('renders nothing in the callout form when the model has no warnings', async () => {
    const root = await render(LANTERN, 'callout');
    expect(root.querySelector('details')).toBeNull();
    expect(root.textContent.trim()).toBe('');
  });
});

describe('WarningsPanel spec edges (T28, ISC-164.1, ISC-162.4)', () => {
  type Row = DashboardModel['specs'][number];
  const text = (el: Element | null): string => (el?.textContent ?? '').replace(/\s+/gu, ' ').trim();
  const PATHS = ['web/src/app/layout/shell/areas.ts', 'web/src/app/layout/shell/index.ts', 'web/src/app/board/index.ts', 'core/src/a.ts', 'core/src/b.ts'];
  const row = (id: string, warnings: Row['warnings']): Row => ({ ...HARBOR.specs[0], id, title: `Spec ${id}`, warnings, fog: 0 });
  const model = (specs: Row[]): DashboardModel => ({ ...HARBOR, specs, kpis: { ...HARBOR.kpis, warnings: specs.length } });

  it('puts the golden overlap on the waiting spec 002: the other spec as a link, the suffix, the edge with copy', async () => {
    const root = await render(HARBOR);
    const line = root.querySelector('[data-warning-spec="002"] [data-warning-kind="spec-overlap"]') as HTMLElement;
    expect(root.querySelectorAll('[data-warning-kind="spec-overlap"]')).toHaveLength(1);
    expect(text(line.querySelector('[data-overlap-text]'))).toBe('shares 1 file with 004, no edge');
    expect(line.querySelector('a[data-overlap-other]')?.getAttribute('href')).toBe('/?sel=spec:004');
    const path = line.querySelector('[data-overlap-path]') as HTMLElement;
    expect(text(path)).toBe('retention/');
    expect(path.title).toBe('web/src/app/retention/');
    expect(line.querySelector('[data-overlap-more]')).toBeNull();
    expect(text(line.querySelector('[data-overlap-edge] code'))).toBe('(after: 004)');
    expect(text(line.querySelector('[data-overlap-target]'))).toBe('in 002');
  });

  it('shows three paths as unique suffixes, then "+n more" opening every full path', async () => {
    const overlap = { specs: ['017', '024'] as [string, string], paths: PATHS, waiting: '017', edge: '(after: 024)' };
    const root = await render(model([row('017', [{ kind: 'spec-overlap', text: 'shares 5 files with 024, no edge', overlap }])]));
    const line = root.querySelector('[data-warning-kind="spec-overlap"]') as HTMLElement;
    expect([...line.querySelectorAll('[data-overlap-path]')].map(text)).toEqual(['areas.ts', 'shell/index.ts', 'board/index.ts']);
    expect(text(line.querySelector('[data-overlap-more]'))).toBe('+2 more');
    expect([...line.querySelectorAll('[data-overlap-all] li')].map(text)).toEqual(PATHS);
  });

  it('copies exactly the edge of the waiting spec and confirms it on the button', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const fixture = await mount(HARBOR, undefined, true);
    const button = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('[data-overlap-edge] button') as HTMLButtonElement;
    expect(button.getAttribute('aria-label')).toBe('Copy (after: 004) · warning 1 of 1 on 002');
    button.click();
    await fixture.whenStable();
    expect(writeText).toHaveBeenCalledWith('(after: 004)');
    expect(button.hasAttribute('data-copied')).toBe(true);
    Reflect.deleteProperty(navigator, 'clipboard');
  });

  it('draws a spec-edge diagnostic as its own line with its place, no chip', async () => {
    const unknown = { kind: 'spec-edge' as const, text: 'The spec edge (after: 042) on T1 names no spec, active or archived; it stays open.', ref: 'tasks.md' };
    const cycle = { kind: 'spec-edge' as const, text: 'Spec edges form the cycle 017 → 024 → 017; every edge in it stays open.', ref: 'spec.md' };
    const root = await render(model([row('002', [unknown, cycle])]));
    const lines = [...root.querySelectorAll('[data-warning-kind="spec-edge"]')];
    expect(lines.map((l) => text(l.querySelector('[data-edge-text]')))).toEqual(['edge to 042 · no such spec', 'edge cycle 017 → 024 → 017']);
    expect(lines.map((l) => text(l.querySelector('[data-edge-where]')))).toEqual(['tasks.md · T1', 'spec.md']);
    expect(lines.every((l) => l.querySelector('ui-command-chip') === null)).toBe(true);
  });
});

// Spec 058 (T46, ISC-399): the section form (the dashboard) keeps one list of groups in one card right under its
// header; the two columns from 640 px of shell and the 8 px header gap are layout, measured in the browser tier.
describe('WarningsPanel section form (spec 058, T46)', () => {
  it('holds the header, then one card with one list of every group in model order', async () => {
    const root = await render(HARBOR, 'section');
    const section = root.querySelector('section.section') as HTMLElement;
    expect([...section.children].map((el) => el.tagName.toLowerCase())).toEqual(['h2', 'div']);
    const lists = section.querySelectorAll('ui-card ul.groups');
    expect(lists).toHaveLength(1);
    const groups = [...lists[0].children];
    expect(groups.every((g) => g.matches('li.group[data-warning-spec]'))).toBe(true);
    expect(groups.map((g) => g.getAttribute('data-warning-spec'))).toEqual(withNotes(HARBOR).map((r) => r.id));
  });
});

// Spec 064 (T32, ISC-476): the section form folds. Its heading holds one native button that names the toggle, says the
// summary, controls the list region and starts closed; the callout form is untouched (its tests above).
describe('WarningsPanel fold (spec 064, T32)', () => {
  const text = (el: Element | null): string => (el?.textContent ?? '').replace(/\s+/gu, ' ').trim();
  const toggleOf = (root: HTMLElement) => root.querySelector('h2#warnings > button[data-warnings-toggle]') as HTMLButtonElement;
  const summary = `${HARBOR.kpis.warnings} warnings in ${withWarnings(HARBOR).length} specs`;

  it('starts closed: only the header row, its summary and alert icon, aria-expanded false, the region hidden', async () => {
    const root = (await mount(HARBOR)).nativeElement as HTMLElement;
    const toggle = toggleOf(root);
    expect(toggle).not.toBeNull();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.getAttribute('aria-label')).toBe('Show warnings');
    expect(text(toggle.querySelector('[data-warnings-summary]'))).toBe(summary);
    expect(toggle.querySelector('ui-icon[data-icon="triangle-alert"]')).not.toBeNull();
    expect(toggle.querySelector('ui-icon[data-icon="chevron-down"]')).not.toBeNull();
    expect(root.querySelector('[data-warning-spec]')).toBeNull();
    expect(root.querySelector('ui-card')).toBeNull();
    const region = root.querySelector(`#${toggle.getAttribute('aria-controls') ?? 'none'}`) as HTMLElement;
    expect(region).not.toBeNull();
    expect(region.hidden).toBe(true);
  });

  it('opens on click: the card with every group, aria-expanded true, openChange true; a second click closes', async () => {
    const fixture = await mount(HARBOR);
    const changes: boolean[] = [];
    fixture.componentInstance.open.subscribe((value) => changes.push(value));
    const root = fixture.nativeElement as HTMLElement;
    toggleOf(root).click();
    await fixture.whenStable();
    const toggle = toggleOf(root);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.getAttribute('aria-label')).toBe('Hide warnings');
    const region = root.querySelector(`#${toggle.getAttribute('aria-controls') ?? 'none'}`) as HTMLElement;
    expect(region.hidden).toBe(false);
    expect(region.querySelectorAll('ui-card [data-warning-spec]').length).toBe(withNotes(HARBOR).length);
    expect(text(root.querySelector('[data-warnings-count]'))).toBe(String(HARBOR.kpis.warnings));
    toggle.click();
    await fixture.whenStable();
    expect(toggleOf(root).getAttribute('aria-expanded')).toBe('false');
    expect(root.querySelector('[data-warning-spec]')).toBeNull();
    expect(changes).toEqual([true, false]);
  });

  it('is a native, focusable button that leaves Enter and Space to the browser, which then toggles it', async () => {
    const fixture = await mount(HARBOR);
    const root = fixture.nativeElement as HTMLElement;
    const toggle = toggleOf(root);
    expect(toggle).toBeInstanceOf(HTMLButtonElement);
    expect(toggle.type).toBe('button');
    expect(toggle.disabled).toBe(false);
    expect(toggle.hasAttribute('tabindex')).toBe(false);
    toggle.focus();
    expect(document.activeElement).toBe(toggle);
    for (const [key, expanded] of [['Enter', 'true'], [' ', 'false']] as const) {
      const down = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      toggle.dispatchEvent(down);
      // Nothing intercepts the key, so the browser runs the button's activation: the click it fires.
      expect(down.defaultPrevented).toBe(false);
      toggle.click();
      await fixture.whenStable();
      expect(toggleOf(root).getAttribute('aria-expanded')).toBe(expanded);
    }
  });

  it('says "No warnings" without the alert icon when the model has none; open, the region holds the empty line', async () => {
    const fixture = await mount(LANTERN);
    const root = fixture.nativeElement as HTMLElement;
    const toggle = toggleOf(root);
    expect(text(toggle.querySelector('[data-warnings-summary]'))).toBe('No warnings');
    expect(toggle.querySelector('ui-icon[data-icon="triangle-alert"]')).toBeNull();
    toggle.click();
    await fixture.whenStable();
    expect(root.querySelector('[data-warnings-empty]')).not.toBeNull();
  });

  it('carries every toggle and summary text in both catalogues', () => {
    for (const lang of LANGS) {
      const warnings = (CATALOGUES[lang] as Record<string, Record<string, unknown>>)['warnings'];
      const toggle = warnings['toggle'] as Record<string, string>;
      const texts = [toggle['open'], toggle['close'], warnings['title'], warnings['empty']];
      expect(texts.every((v) => typeof v === 'string' && v.length > 0)).toBe(true);
    }
  });
});
