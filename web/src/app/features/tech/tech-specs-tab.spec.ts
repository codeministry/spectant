import { signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslocoTestingModule } from '@jsverse/transloco';
import dashboard from '../../../../../core/fixtures/harbor.golden.json';
import harborTech from '../../../../../core/fixtures/harbor.tech.golden.json';
import type { TechModel } from '../../../../../core/src/files';
import { CATALOGUES, LANGS } from '../../../i18n/catalogues';
import { ShellData, type SpecRowView } from '../../layout/shell/shell-data.service';
import { ShellState } from '../../layout/shell/shell-state.service';
import type { Tier } from '../../layout/shell/tier';
import { techSpecGroups, TechSpecsTab } from './tech-specs-tab';

// T17 · ISC-134.1: the Specs tab against the harbor tech golden: one card per spec with id, type glyph and title, the
// goal always and the approach only with a plan, the document links and their accessible names, the dashboard order
// with the complete specs behind the "Complete · n" divider, and the four-line clip with "More…" below wide.

const HARBOR = harborTech as unknown as TechModel;
const ROWS: readonly SpecRowView[] = (dashboard as unknown as { specs: SpecRowView[] }).specs.map((row) => ({
  id: row.id,
  title: row.title,
  type: row.type,
  stage: row.stage,
}));

const text = (el: Element | null | undefined): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

async function render(model: TechModel = HARBOR, tier: Tier = 'wide', rows: readonly SpecRowView[] = ROWS): Promise<ComponentFixture<TechSpecsTab>> {
  TestBed.configureTestingModule({
    imports: [TranslocoTestingModule.forRoot({ langs: CATALOGUES, translocoConfig: { availableLangs: [...LANGS], defaultLang: 'en' }, preloadLangs: true })],
    providers: [
      provideRouter([]),
      { provide: ShellState, useValue: { ws: signal('harbor'), tier: signal(tier) } },
      { provide: ShellData, useValue: { specRows: signal(rows) } },
    ],
  });
  const fixture = TestBed.createComponent(TechSpecsTab);
  fixture.componentRef.setInput('model', model);
  await fixture.whenStable();
  return fixture;
}

const cards = (fixture: ComponentFixture<TechSpecsTab>): HTMLElement[] =>
  [...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('[data-tech-spec]')];
const card = (fixture: ComponentFixture<TechSpecsTab>, id: string): HTMLElement | null =>
  (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(`[data-tech-spec="${id}"]`);

describe('TechSpecsTab', () => {
  it('renders one ui-card per spec with the mono id, the type glyph and the dashboard title', async () => {
    const fixture = await render();
    const all = cards(fixture);
    expect(all).toHaveLength(HARBOR.specs.length);
    expect(all.every((el) => el.tagName === 'UI-CARD')).toBe(true);
    const c002 = card(fixture, '002');
    expect(c002?.id).toBe('spec-002');
    expect(text(c002?.querySelector('.sid'))).toBe('002');
    expect(c002?.querySelector('ui-type-glyph')?.getAttribute('data-type')).toBe('feature');
    expect(text(c002?.querySelector('h2'))).toBe('Show every sync run and its failures in a small web console');
    expect(text(c002?.querySelector('[data-tech-goal] .docs-prose'))).toContain('A teammate opens the console');
  });

  it('shows the approach only for a spec with a plan, and no empty block without one', async () => {
    const fixture = await render();
    for (const spec of HARBOR.specs) {
      const el = card(fixture, spec.id);
      expect(el?.querySelector('[data-tech-goal]') !== null).toBe(spec.goal !== null);
      expect(el?.querySelector('[data-tech-approach]') !== null).toBe(spec.approach !== null);
    }
    expect(card(fixture, '002')?.querySelector('[data-tech-approach]')).not.toBeNull();
    expect(card(fixture, '005')?.querySelector('[data-tech-approach]')).toBeNull();
    expect(text(card(fixture, '005'))).not.toContain('Approach');
  });

  it('links the goal to the spec page, the approach to Docs › Plan and the footer to the spec, named by their target', async () => {
    const fixture = await render();
    const c002 = card(fixture, '002');
    const goal = c002?.querySelector<HTMLAnchorElement>('a[data-tech-link="goal"]');
    const plan = c002?.querySelector<HTMLAnchorElement>('a[data-tech-link="plan"]');
    const open = c002?.querySelector<HTMLAnchorElement>('a[data-tech-link="spec"]');
    expect(goal?.getAttribute('href')).toBe('/w/harbor/s/002');
    expect(goal?.hasAttribute('aria-label')).toBe(false);
    expect(text(goal)).toBe('Goal · Goal of 002');
    expect(goal?.querySelector('.vh')?.textContent.trim()).toBe('· Goal of 002');
    expect(plan?.getAttribute('href')).toBe('/w/harbor/s/002/plan');
    expect(plan?.hasAttribute('aria-label')).toBe(false);
    expect(text(plan)).toBe('Approach · Plan of 002');
    expect(open?.getAttribute('href')).toBe('/w/harbor/s/002');
    expect(text(open)).toBe('Open spec');
    expect(open?.getAttribute('aria-describedby')).toBe('spec-title-002');
    expect(card(fixture, '005')?.querySelector('a[data-tech-link="plan"]')).toBeNull();
  });

  it('orders the cards as the dashboard rows, without a divider while no row stands in done', async () => {
    const rows = ROWS.map((row) => (row.stage === 'done' ? { ...row, stage: 'build' } : row));
    const fixture = await render(HARBOR, 'wide', rows);
    expect(cards(fixture).map((el) => el.dataset['techSpec'])).toEqual(rows.map((row) => row.id));
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-tech-divider]')).toBeNull();
  });

  it('puts the specs whose dashboard row stands in done last, behind "Complete · n", muted — as the Status tab counts them', async () => {
    const complete = new Set(['004', '003']);
    const rows = ROWS.map((row) => ({ ...row, stage: complete.has(row.id) ? 'done' : row.stage === 'done' ? 'build' : row.stage }));
    const fixture = await render(HARBOR, 'wide', rows);
    const order = rows.map((row) => row.id);
    const expected = [...order.filter((id) => !complete.has(id)), ...order.filter((id) => complete.has(id))];
    expect(cards(fixture).map((el) => el.dataset['techSpec'])).toEqual(expected);
    const host = fixture.nativeElement as HTMLElement;
    const divider = host.querySelector('[data-tech-divider]');
    expect(text(divider)).toBe('Complete · 2');
    expect(host.querySelectorAll('[data-tech-divider]')).toHaveLength(1);
    expect(cards(fixture).filter((el) => el.hasAttribute('data-complete')).map((el) => el.dataset['techSpec'])).toEqual(expected.slice(-2));
  });

  it('keeps specs the dashboard has no row for, in number order after the rows, still titled by core', async () => {
    const groups = techSpecGroups(HARBOR.specs, ROWS.filter((row) => row.id !== '002' && row.id !== '007'));
    expect(groups.open.slice(-2).map((entry) => [entry.spec.id, entry.spec.title])).toEqual([
      ['002', 'Show every sync run and its failures in a small web console'],
      ['007', 'Replace the push token without stopping a scheduled sync'],
    ]);
    // The heading reads TechSpec.title, never a dashboard row: with no rows at all every card keeps its title.
    const fixture = await render(HARBOR, 'wide', []);
    const rowless = techSpecGroups(HARBOR.specs, []);
    const titles = [...rowless.open, ...rowless.complete].map((entry) => entry.spec.title);
    expect(titles).toHaveLength(HARBOR.specs.length);
    expect(cards(fixture).map((el) => text(el.querySelector('h2')))).toEqual(titles);
    expect(groups.complete).toEqual([]);
  });

  it('shows the excerpts whole at wide, without a "More…" toggle', async () => {
    const fixture = await render(HARBOR, 'wide');
    const host = fixture.nativeElement as HTMLElement;
    expect(host.getAttribute('data-tier')).toBe('wide');
    expect(host.querySelector('[data-clipped]')).toBeNull();
    expect(host.querySelector('[data-tech-more]')).toBeNull();
    expect(card(fixture, '002')?.getAttribute('style')).toContain('padding: 24px');
  });

  it('clips each excerpt to four lines below wide, "More…" expanding it and "Less" folding it back', async () => {
    const fixture = await render(HARBOR, 'compact');
    const c002 = card(fixture, '002');
    const clip = c002?.querySelector<HTMLElement>('[data-tech-goal] .clip');
    const more = c002?.querySelector<HTMLButtonElement>('[data-tech-more="goal"]');
    expect(clip?.hasAttribute('data-clipped')).toBe(true);
    expect(more?.getAttribute('aria-controls')).toBe(clip?.id);
    expect(more?.getAttribute('aria-expanded')).toBe('false');
    expect(text(more)).toBe('More…');
    expect(c002?.querySelector('[data-tech-more="approach"]')).not.toBeNull();

    more?.click();
    await fixture.whenStable();
    expect(clip?.hasAttribute('data-clipped')).toBe(false);
    expect(more?.getAttribute('aria-expanded')).toBe('true');
    expect(text(more)).toBe('Less');
    expect(c002?.querySelector('[data-tech-approach] .clip')?.hasAttribute('data-clipped')).toBe(true);

    more?.click();
    await fixture.whenStable();
    expect(clip?.hasAttribute('data-clipped')).toBe(true);
  });
});
