import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslocoTestingModule } from '@jsverse/transloco';
import empty from '../../../../../../core/fixtures/empty-master.golden.json';
import harbor from '../../../../../../core/fixtures/harbor.golden.json';
import lantern from '../../../../../../core/fixtures/lantern.golden.json';
import type { DashboardView as DashboardModel, DashboardRowView as DashboardSpecRow } from '../context-rail/dashboard-view';
import { CATALOGUES, LANGS } from '../../../../i18n/catalogues';
import { NextUpList } from './next-up-list';

const HARBOR = harbor as unknown as DashboardModel;
const LANTERN = lantern as unknown as DashboardModel;
const EMPTY = empty as unknown as DashboardModel;

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

async function render(model: Pick<DashboardModel, 'specs' | 'nextUp'>, form?: 'card' | 'rail'): Promise<HTMLElement> {
  const fixture = TestBed.createComponent(NextUpList);
  fixture.componentRef.setInput('specs', model.specs);
  fixture.componentRef.setInput('ids', model.nextUp);
  if (form) fixture.componentRef.setInput('form', form);
  await fixture.whenStable();
  return fixture.nativeElement as HTMLElement;
}

const entries = (root: Element): string[] =>
  [...root.querySelectorAll(':scope [data-next-entry]')].map((e) => e.getAttribute('data-next-entry') ?? '');
const row = (id: string): DashboardSpecRow => HARBOR.specs.find((r) => r.id === id) as DashboardSpecRow;

describe('NextUpList', () => {
  it("lists the model's nextUp ids in order, each with its next command and a preview link", async () => {
    const root = await render(HARBOR);
    const primary = root.querySelector('[data-next-primary]') as HTMLElement;
    expect(entries(primary)).toEqual([...HARBOR.nextUp]);
    for (const id of HARBOR.nextUp) {
      const entry = primary.querySelector(`[data-next-entry="${id}"]`) as HTMLElement;
      expect(entry.querySelector('ui-command-chip code')?.textContent).toBe(row(id).nextCommand);
      expect(entry.querySelector('a[data-next-link]')?.getAttribute('href')).toBe(`/?spec=${id}`);
      expect(entry.textContent).toContain(row(id).title);
    }
  });

  it('carries a focusable "Next up" heading with the id the g n sequence lands on', async () => {
    const root = await render(HARBOR);
    const heading = root.querySelector('#next-up') as HTMLElement;
    expect(heading.textContent.trim()).toBe('Next up');
    expect(heading.getAttribute('tabindex')).toBe('-1');
  });

  it('folds every further row with a next command behind "Show all n", in model row order', async () => {
    const root = await render(HARBOR);
    const withCommand = HARBOR.specs.filter((r) => r.nextCommand !== null).map((r) => r.id);
    const fold = root.querySelector('[data-show-all]') as HTMLElement;
    expect(fold.textContent).toContain(`Show all ${withCommand.length}`);
    expect(entries(fold)).toEqual(withCommand.filter((id) => !HARBOR.nextUp.includes(id)));
  });

  it('shows no fold when nextUp already holds every row with a next command', async () => {
    const root = await render(LANTERN);
    expect(entries(root)).toEqual([...LANTERN.nextUp]);
    expect(root.querySelector('[data-show-all]')).toBeNull();
  });

  it('gives each entry a labelled stage track and a takeable chip at the rail form only', async () => {
    let chips = 0;
    let rail: HTMLElement | null = null;
    for (const model of [HARBOR, LANTERN]) {
      rail = await render(model, 'rail');
      for (const id of model.nextUp) {
        const entry = rail.querySelector(`[data-next-primary] [data-next-entry="${id}"]`) as HTMLElement;
        const track = entry.querySelector('ui-stage-track ol');
        expect(track?.getAttribute('aria-label')).toMatch(/^Stage \d of 5: /);
        const takeable = entry.querySelector('[data-next-takeable]');
        const first = model.specs.find((r) => r.id === id)?.takeable[0];
        if (first) {
          chips += 1;
          expect(takeable?.textContent.trim()).toBe(`takeable ${first}`);
        } else expect(takeable).toBeNull();
      }
    }
    expect(chips).toBeGreaterThan(0);
    expect(rail?.getAttribute('data-form')).toBe('rail');

    const card = await render(HARBOR, 'card');
    expect(card.querySelector('[data-next-primary] ui-stage-track')).toBeNull();
    expect(card.getAttribute('data-form')).toBe('card');
  });

  it('ports the rail from the prototype: an eyebrow heading with the count, then one next-card per entry', async () => {
    const root = await render(HARBOR, 'rail');
    const eyebrow = root.querySelector('[data-next-eyebrow]') as HTMLElement;
    expect(eyebrow.querySelector('#next-up')?.classList).toContain('type-eyebrow');
    const withCommand = HARBOR.specs.filter((r) => r.nextCommand !== null).length;
    expect(eyebrow.querySelector('[data-next-count]')?.textContent.trim()).toBe(String(withCommand));
    expect(root.querySelector('ui-section-header')).toBeNull();
    for (const id of HARBOR.nextUp) {
      const card = root.querySelector(`[data-next-primary] [data-next-entry="${id}"] ui-card[data-next-card]`) as HTMLElement;
      expect(card).not.toBeNull();
      expect(card.hasAttribute('data-edge')).toBe(false);
      const title = card.querySelector('h3') as HTMLElement;
      expect(title.querySelector('ui-id-chip')?.textContent.trim()).toBe(id);
      expect(title.querySelector('a[data-next-link]')?.textContent.trim()).toBe(row(id).title);
      expect(card.querySelector('[data-next-foot] ui-command-chip code')?.textContent).toBe(row(id).nextCommand);
    }
  });

  it('ports the card form to next-rows under the section header: id and title, the command below', async () => {
    const root = await render(HARBOR, 'card');
    expect(root.querySelector('ui-section-header #next-up')).not.toBeNull();
    const rows = [...root.querySelectorAll('[data-next-primary] [data-next-row]')];
    expect(rows.length).toBe(HARBOR.nextUp.length);
    expect(rows[0]?.querySelector('ui-id-chip')?.textContent.trim()).toBe(HARBOR.nextUp[0]);
  });

  it('says nothing is ready to build when nextUp is empty, without a fog link when no spec waits on fog', async () => {
    const root = await render(EMPTY);
    expect(entries(root)).toEqual([]);
    expect(root.querySelector('[data-next-empty]')?.textContent).toContain('Nothing ready to build');
    expect(root.querySelector('[data-next-fog]')).toBeNull();
  });

  it('links the specs that wait on fog to the fog filter when nothing is ready', async () => {
    const waiting = HARBOR.specs.filter((r) => r.fog > 0).map((r) => ({ ...r, nextCommand: null }));
    expect(waiting.length).toBeGreaterThan(0);
    const root = await render({ specs: waiting, nextUp: [] });
    const link = root.querySelector('a[data-next-fog]') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/?phase=fog');
    expect(link.textContent.trim()).toBe(waiting.length === 1 ? '1 spec waits on fog' : `${waiting.length} specs wait on fog`);
  });
});
