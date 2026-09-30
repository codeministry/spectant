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

async function render(model: DashboardModel, form?: WarningsForm): Promise<HTMLElement> {
  const fixture = TestBed.createComponent(WarningsPanel);
  fixture.componentRef.setInput('specs', model.specs);
  fixture.componentRef.setInput('kpis', model.kpis);
  if (form) fixture.componentRef.setInput('form', form);
  await fixture.whenStable();
  return fixture.nativeElement as HTMLElement;
}

const withWarnings = (model: DashboardModel) => model.specs.filter((r) => r.warnings.length > 0);
/** The prototype's groups: every spec with a warning or open fog, in model order. */
const withNotes = (model: DashboardModel) => model.specs.filter((r) => r.warnings.length > 0 || r.fog > 0);

describe('WarningsPanel', () => {
  it('groups the lines by spec in model order, one line per model warning, under a focusable heading', async () => {
    const root = await render(HARBOR);
    const heading = root.querySelector('#warnings') as HTMLElement;
    expect(heading.textContent.trim()).toBe('Warnings');
    expect(heading.getAttribute('tabindex')).toBe('-1');

    const groups = [...root.querySelectorAll('[data-warning-spec]')];
    expect(groups.map((g) => g.getAttribute('data-warning-spec'))).toEqual(withNotes(HARBOR).map((r) => r.id));
    for (const spec of withWarnings(HARBOR)) {
      const group = root.querySelector(`[data-warning-spec="${spec.id}"]`) as HTMLElement;
      const lines = [...group.querySelectorAll('[data-warning-kind]')];
      expect(lines.map((i) => i.getAttribute('data-warning-kind'))).toEqual(spec.warnings.map((w) => w.kind));
      spec.warnings.forEach((w, i) => {
        const line = lines[i] as HTMLElement;
        expect(line.querySelector('ui-icon[data-icon="triangle-alert"]')).not.toBeNull();
        const link = line.querySelector('a[data-warning-link]') as HTMLAnchorElement;
        expect(link.getAttribute('href')).toBe(`/?spec=${spec.id}`);
        expect(link.textContent.trim()).toBe(spec.id);
        expect(line.querySelector('[data-warning-text]')?.textContent.trim()).toBe(w.text);
        expect(line.querySelector('ui-command-chip code')?.textContent ?? null).toBe(w.command ?? null);
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
      expect(line.querySelector('ui-icon[data-icon="cloud-fog"]')).not.toBeNull();
      expect(line.querySelector('a[data-warning-link]')?.getAttribute('href')).toBe(`/?spec=${spec.id}`);
      expect(line.textContent).toContain(spec.fog === 1 ? '1 open fog item' : `${spec.fog} open fog items`);
    }
    expect(root.querySelector('[data-open-fog]')).toBeNull();
  });

  it("states the model's warning count and the specs they sit in", async () => {
    const root = await render(HARBOR);
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

  it('ports the rail from the prototype: an eyebrow heading with the count above one card of lines', async () => {
    const root = await render(HARBOR, 'rail');
    expect(root.getAttribute('data-form')).toBe('rail');
    const eyebrow = root.querySelector('[data-warnings-eyebrow]') as HTMLElement;
    expect(eyebrow.querySelector('#warnings')?.classList).toContain('type-eyebrow');
    expect(eyebrow.querySelector('[data-warnings-count]')?.textContent.trim()).toBe(String(HARBOR.kpis.warnings));
    expect(root.querySelector('ui-section-header')).toBeNull();
    const card = root.querySelector('ui-card') as HTMLElement;
    expect(card.querySelectorAll('[data-warning-spec]').length).toBe(withNotes(HARBOR).length);
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
