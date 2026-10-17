import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslocoService, TranslocoTestingModule } from '@jsverse/transloco';
import { CATALOGUES, LANGS } from '../../../i18n/catalogues';
import { KeyboardService } from '../../core/keyboard.service';
import { PALETTE_SOURCES, type PaletteEntry, type PaletteSource } from '../../core/palette-sources';
import { formatDay } from '../../shared/time';
import { ShellState } from '../shell/shell-state.service';
import { CommandPalette } from './command-palette';
import { PaletteIndex } from './palette-index';
import { PaletteRecent } from './palette-recent';

/** A milestone row as the Milestones group builds it: its target as a calendar day beside the state word. */
const MILESTONE: PaletteEntry = {
  id: 'milestone-harbor-0-9',
  label: 'Harbor 0.9',
  meta: 'late',
  metaTime: { value: '2026-03-15', form: 'day' },
  link: '/w/harbor/planning/tree?sel=milestone:harbor-0-9',
  keywords: ['Harbor 0.9'],
};

const source = (entries: readonly PaletteEntry[]): PaletteSource => ({
  id: 'milestones',
  labelKey: 'palette.groups.milestones',
  order: 55,
  entries: signal(entries),
});

describe('CommandPalette option', () => {
  beforeEach(() => {
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
        { provide: PALETTE_SOURCES, useValue: source([MILESTONE]), multi: true },
        { provide: KeyboardService, useValue: { paletteOpen: signal(true) } },
        { provide: ShellState, useValue: { tier: signal('wide') } },
        { provide: PaletteIndex, useValue: { settled: computed(() => true), workspaces: computed(() => []), want: () => undefined } },
        { provide: PaletteRecent, useValue: { remember: () => undefined } },
      ],
    });
  });

  async function option(): Promise<HTMLElement> {
    const fixture = TestBed.createComponent(CommandPalette);
    await fixture.whenStable();
    const found = document.querySelector<HTMLElement>('[data-entry="milestone-harbor-0-9"]');
    if (found === null) throw new Error('the milestone option did not render');
    return found;
  }

  afterEach(() => {
    document.querySelectorAll('[data-ui="command-palette"]').forEach((el) => el.closest('ui-dialog')?.remove());
  });

  it('renders metaTime as a calendar day through ui-time, and the accessible name reads the same text', async () => {
    const row = await option();
    const time = row.querySelector('time');

    expect(time?.getAttribute('datetime')).toBe('2026-03-15');
    expect(time?.textContent).toBe('03/15/2026');
    expect(row.getAttribute('aria-label')).toBe('Harbor 0.9, 03/15/2026, late');
  });

  it('follows the active language in both the shown day and the accessible name', async () => {
    TestBed.inject(TranslocoService).setActiveLang('de');
    const row = await option();

    expect(row.querySelector('time')?.textContent).toBe(formatDay('2026-03-15', 'de'));
    expect(row.getAttribute('aria-label')).toBe('Harbor 0.9, 15.03.2026, late');
  });
});
