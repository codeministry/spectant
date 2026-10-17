import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslocoService, TranslocoTestingModule } from '@jsverse/transloco';
import type { RepoFileSource } from '../../../../../../core/src/files';
import { CATALOGUES, LANGS } from '../../../../i18n/catalogues';
import { UiSourceChip } from './source-chip';

// Spec 039, ISC-209: a repository file read from a spec worktree's copy names that worktree; one read from the main
// checkout carries no chip.

@Component({
  imports: [UiSourceChip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<ui-source-chip [source]="source()" />`,
})
class Host {
  readonly source = signal<RepoFileSource | null | undefined>(undefined);
}

async function render(source: RepoFileSource | null | undefined) {
  const fixture = TestBed.createComponent(Host);
  fixture.componentInstance.source.set(source);
  await fixture.whenStable();
  const chip = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('ui-source-chip');
  if (chip === null) throw new Error('chip missing');
  return { fixture, chip };
}

describe('ui-source-chip (spec 039, ISC-209)', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [
        TranslocoTestingModule.forRoot({
          langs: CATALOGUES,
          translocoConfig: { availableLangs: [...LANGS], defaultLang: 'en', reRenderOnLangChange: true },
          preloadLangs: true,
        }),
      ],
    });
  });

  it('names the worktree a file was read from: the folder visible, the whole path in the accessible name', async () => {
    const { chip } = await render({ kind: 'worktree', worktree: '.worktrees/012-harbor' });
    expect(chip.hasAttribute('hidden')).toBe(false);
    expect(chip.getAttribute('data-source-chip')).toBe('.worktrees/012-harbor');
    expect(chip.textContent.replace(/\s+/g, ' ').trim()).toBe('from worktree 012-harbor');
    const face = chip.querySelector('ui-chip');
    expect(face?.getAttribute('aria-label')).toBe('Read from the worktree .worktrees/012-harbor, not from the main checkout');
    expect(face?.getAttribute('title')).toBe(face?.getAttribute('aria-label'));
  });

  it('renders nothing for the main checkout, absent or named', async () => {
    for (const source of [undefined, null, { kind: 'main' } as const]) {
      const { chip } = await render(source);
      expect(chip.hasAttribute('hidden')).toBe(true);
      expect(chip.querySelector('ui-chip')).toBeNull();
    }
  });

  it('speaks German formally', async () => {
    const { fixture, chip } = await render({ kind: 'worktree', worktree: '.worktrees/012-harbor' });
    TestBed.inject(TranslocoService).setActiveLang('de');
    await fixture.whenStable();
    expect(chip.textContent.replace(/\s+/g, ' ').trim()).toBe('aus Worktree 012-harbor');
    expect(chip.querySelector('ui-chip')?.getAttribute('aria-label')).toBe('Aus dem Worktree .worktrees/012-harbor gelesen, nicht aus dem Haupt-Checkout');
  });
});
