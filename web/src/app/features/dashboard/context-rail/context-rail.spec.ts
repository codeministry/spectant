import { ChangeDetectionStrategy, Component, input, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslocoTestingModule } from '@jsverse/transloco';
import harbor from '../../../../../../core/fixtures/harbor.golden.json';
import type { DashboardView } from './dashboard-view';
import { CATALOGUES, LANGS } from '../../../../i18n/catalogues';
import { RailContent } from '../../../layout/shell/rail-content';
import { RailSlot } from '../../../layout/shell/rail-slot';
import { ShellState } from '../../../layout/shell/shell-state.service';
import type { Tier } from '../../../layout/shell/tier';
import { type ContextRailInline, ContextRail } from './context-rail';

const HARBOR = harbor as unknown as DashboardView;

/** The shell's rail slot beside the page's rail component, as the shell and the dashboard page place them. */
@Component({
  selector: 'app-test-host',
  imports: [ContextRail, RailSlot],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <aside data-test-rail><app-rail-slot /></aside>
    <div data-test-page>
      @if (show()) {
        <app-context-rail [model]="model()" [inline]="inline()" />
      }
    </div>
  `,
})
class TestHost {
  readonly model = input.required<DashboardView>();
  readonly inline = input<ContextRailInline>('all');
  readonly show = input(true);
}

const tier = signal<Tier>('wide');

beforeEach(() => {
  tier.set('wide');
  TestBed.configureTestingModule({
    imports: [
      TranslocoTestingModule.forRoot({
        langs: CATALOGUES,
        translocoConfig: { availableLangs: [...LANGS], defaultLang: 'en' },
        preloadLangs: true,
      }),
    ],
    providers: [provideRouter([]), { provide: ShellState, useValue: { tier } }],
  });
});

async function render(inputs: { inline?: ContextRailInline } = {}) {
  const fixture = TestBed.createComponent(TestHost);
  fixture.componentRef.setInput('model', HARBOR);
  if (inputs.inline) fixture.componentRef.setInput('inline', inputs.inline);
  await fixture.whenStable();
  const root = fixture.nativeElement as HTMLElement;
  return {
    fixture,
    rail: root.querySelector('[data-test-rail]') as HTMLElement,
    page: root.querySelector('[data-test-page]') as HTMLElement,
  };
}

describe('ContextRail', () => {
  it('puts Next up and Warnings into the shell rail at wide, in rail form, and nothing inline', async () => {
    const { rail, page } = await render();
    expect(TestBed.inject(RailContent).blocks()).not.toBeNull();
    const next = rail.querySelector('[data-rail-blocks] app-next-up-list') as HTMLElement;
    const warnings = rail.querySelector('[data-rail-blocks] app-warnings-panel') as HTMLElement;
    expect(next.getAttribute('data-form')).toBe('rail');
    expect(warnings.getAttribute('data-form')).toBe('rail');
    expect([...rail.querySelectorAll('[data-rail-blocks] > *')].map((e) => e.tagName.toLowerCase())).toEqual([
      'app-next-up-list',
      'app-warnings-panel',
    ]);
    expect(page.querySelector('app-next-up-list, app-warnings-panel')).toBeNull();
  });

  it("gives the collapsed strip the model's Next up and warning counts", async () => {
    await render();
    expect(TestBed.inject(RailContent).badges()).toEqual([
      { key: 'nextUp', count: HARBOR.nextUp.length, label: `Next up: ${HARBOR.nextUp.length}` },
      { key: 'warnings', count: HARBOR.kpis.warnings, label: `Warnings: ${HARBOR.kpis.warnings}` },
    ]);
  });

  it('renders the cards inline below wide and leaves the rail placeholder: section at medium', async () => {
    tier.set('medium');
    const { rail, page } = await render();
    expect(TestBed.inject(RailContent).blocks()).toBeNull();
    expect(rail.querySelector('[data-rail-blocks]')).toBeNull();
    expect(page.querySelector('app-next-up-list')?.getAttribute('data-form')).toBe('card');
    expect(page.querySelector('app-warnings-panel')?.getAttribute('data-form')).toBe('section');
  });

  it('renders the warnings as a callout at compact', async () => {
    tier.set('compact');
    const { page } = await render();
    expect(page.querySelector('app-next-up-list')?.getAttribute('data-form')).toBe('card');
    expect(page.querySelector('app-warnings-panel')?.getAttribute('data-form')).toBe('callout');
  });

  it('moves between rail and inline when the tier changes', async () => {
    const { fixture, rail, page } = await render();
    expect(rail.querySelector('[data-rail-blocks] app-next-up-list')).not.toBeNull();
    tier.set('medium');
    await fixture.whenStable();
    expect(rail.querySelector('[data-rail-blocks]')).toBeNull();
    expect(page.querySelector('app-next-up-list')).not.toBeNull();
  });

  it('renders only the part named by inline below wide, but both in the rail at wide', async () => {
    tier.set('medium');
    const nextOnly = await render({ inline: 'next-up' });
    expect(nextOnly.page.querySelector('app-next-up-list')).not.toBeNull();
    expect(nextOnly.page.querySelector('app-warnings-panel')).toBeNull();
    nextOnly.fixture.destroy();

    const warningsOnly = await render({ inline: 'warnings' });
    expect(warningsOnly.page.querySelector('app-next-up-list')).toBeNull();
    expect(warningsOnly.page.querySelector('app-warnings-panel')).not.toBeNull();

    tier.set('wide');
    await warningsOnly.fixture.whenStable();
    expect(warningsOnly.rail.querySelectorAll('[data-rail-blocks] > *').length).toBe(2);
  });

  it('releases the rail when it is destroyed', async () => {
    const { fixture } = await render();
    expect(TestBed.inject(RailContent).blocks()).not.toBeNull();
    fixture.componentRef.setInput('show', false);
    await fixture.whenStable();
    expect(TestBed.inject(RailContent).blocks()).toBeNull();
    expect(TestBed.inject(RailContent).badges()).toBeNull();
  });
});
