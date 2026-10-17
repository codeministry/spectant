import type { IconName } from '../../shared/icons/icons';
import { leadIcon, MONO_GROUPS } from './palette-icons';
import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, DOCUMENT, effect, inject, signal, untracked } from '@angular/core';
import { Router } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { keyLabel } from '../../core/keyboard-bindings';
import { KeyboardService } from '../../core/keyboard.service';
import { LanguageService } from '../../core/language.service';
import { PALETTE_SOURCES, type PaletteEntry, type PaletteSource } from '../../core/palette-sources';
import { UiIcon } from '../../shared/icons/icon';
import { UiChip } from '../../shared/ui/chip/chip';
import { chipIcon } from '../../shared/ui/chip/chip-icons';
import { UiClamp } from '../../shared/ui/clamp/clamp';
import { UiKbd } from '../../shared/ui/kbd/kbd';
import { formatDay, formatInstant, UiTime } from '../../shared/time';
import { UiDialog } from '../../shared/ui/overlay/dialog';
import { nextId } from '../../shared/ui/overlay/ids';
import { UiSheet } from '../../shared/ui/overlay/sheet';
import type { Tone } from '../../shared/ui/tone';
import { ShellState } from '../shell/shell-state.service';
import { follow, isCommitEnter } from './navigate';
import { hasPhase, isClaim, isCommand, isIdea } from './palette-groups';
import { PaletteIndex } from './palette-index';
import { excerpt, highlight, rankGroups, type Segment } from './palette-ranking';
import { PaletteRecent } from './palette-recent';

interface PaletteOption {
  readonly entry: PaletteEntry;
  /** Position in the flat option order the arrows walk. */
  readonly index: number;
  readonly domId: string;
  /** The label as shown: a claim line starts near its text hit (`excerpt`). */
  readonly text: string;
  readonly label: readonly Segment[];
  readonly chip: readonly Segment[];
  readonly ariaLabel: string;
  /** A claim (spec 019): its status as a dot plus the state word. */
  readonly status: { readonly word: string; readonly dot: string } | null;
  /** An idea (spec 008): the chip takes the idea chip's look. */
  readonly idea: boolean;
  /** The prototype's lead icon for the row (palette-icons.ts), or null where the chip leads. */
  readonly icon: IconName | null;
  /** Next up and Services set their labels in mono, as the prototype does. */
  readonly mono: boolean;
  /** A spec's phase chip (prototype `chip(x.chip, x.chip)`): its word, tone and icon; null on any other row. */
  readonly phase: { readonly label: string; readonly tone: Tone; readonly icon: IconName | undefined } | null;
  /** Next up leads with `terminal`, not the id chip. */
  readonly showChip: boolean;
}

/** The phase tones of the dashboard's spec table (`PHASE_TONES`), for a spec row's chip. */
const PHASE_TONE: Readonly<Partial<Record<string, Tone>>> = { scoping: 'secondary', building: 'primary', climbing: 'warning', complete: 'accent' };

interface PaletteGroup {
  readonly id: string;
  readonly labelKey: string;
  readonly headingId: string;
  readonly options: readonly PaletteOption[];
}

/**
 * The command palette (ISC-60, T66; design.md § Command palette and keyboard): a combobox driving a grouped listbox
 * through `aria-activedescendant`, on `ui-dialog` (96 px from the top, 640 px) at medium and wide and on `ui-sheet` at
 * compact. Its groups are every `PALETTE_SOURCES` provider sorted by `order`; a group whose entries are empty, or that
 * the query filters to nothing, renders no heading at all. Recent shows only for an empty query, Claims only with one.
 * With a query the groups follow their best match, so Enter lands on it, and a claim-like query puts Claims first
 * (ranking in palette-ranking.ts, `rankGroups`).
 *
 * Opened by ⌘K / Ctrl+K / `/` and the header trigger through `KeyboardService.paletteOpen`; mounted once by the app
 * root and deferred until the first open. Enter on a navigating entry follows its link through the router and remembers
 * it as recent; a command entry runs; an Enter that commits an IME composition is left alone (navigate.ts, ISC-60.2).
 * Focus returns to the opener on close (modal.ts).
 */
@Component({
  selector: 'app-command-palette',
  imports: [NgTemplateOutlet, TranslocoPipe, UiChip, UiClamp, UiDialog, UiIcon, UiKbd, UiSheet, UiTime],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './command-palette.html',
  styleUrl: './command-palette.css',
})
export class CommandPalette {
  protected readonly keyboard = inject(KeyboardService);
  private readonly shell = inject(ShellState);
  private readonly router = inject(Router);
  private readonly document = inject(DOCUMENT);
  private readonly index = inject(PaletteIndex);
  private readonly recent = inject(PaletteRecent);
  private readonly lang = inject(LanguageService).current;
  private readonly sources: readonly PaletteSource[] = [...(inject(PALETTE_SOURCES, { optional: true }) ?? [])].sort(
    (a, b) => a.order - b.order,
  );

  protected readonly listId = nextId('palette-list');
  protected readonly escLabel = keyLabel('Escape');
  protected readonly compact = computed(() => this.shell.tier() === 'compact');
  protected readonly query = signal('');
  protected readonly active = signal(0);

  /** The sources have answered (`PaletteIndex.settled`): only then is the list drawn, complete and in its final order. */
  protected readonly settled = this.index.settled;

  protected readonly groups = computed<readonly PaletteGroup[]>(() => {
    if (!this.settled()) return [];
    const query = this.query().trim();
    const lang = this.lang();
    // The accessible name reads a metaTime exactly as its <ui-time> shows it, in the active language.
    const when = (time: PaletteEntry['metaTime']): string | null =>
      time === undefined ? null : time.form === 'day' ? formatDay(time.value, lang) : formatInstant(time.value, lang);
    let index = 0;
    return rankGroups(this.sources, query).map(({ source, matches }) => ({
      id: source.id,
      labelKey: source.labelKey,
      headingId: `${this.listId}-${source.id}`,
      options: matches.map(({ entry }) => {
        const at = index++;
        const claim = isClaim(entry) ? entry.claim : null;
        const text = claim === null ? entry.label : excerpt(entry.label, query);
        return {
          entry,
          index: at,
          domId: `${this.listId}-o${String(at)}`,
          text,
          label: highlight(text, query),
          ariaLabel:
            claim?.accessibleName ??
            [entry.label, hasPhase(entry) ? entry.phaseLabel : null, when(entry.metaTime), entry.meta].filter((part) => part !== null && part !== undefined && part !== '').join(', '),
          status: claim === null ? null : { word: claim.statusWord, dot: claim.dot },
          chip: highlight(entry.chip ?? '', query),
          idea: isIdea(entry),
          icon: leadIcon(source.id, entry),
          mono: MONO_GROUPS.has(source.id),
          phase: hasPhase(entry) ? { label: entry.phaseLabel, tone: PHASE_TONE[entry.phase] ?? 'neutral', icon: chipIcon(entry.phase) } : null,
          showChip: source.id !== 'nextUp',
        };
      }),
    }));
  });

  private readonly options = computed(() => this.groups().flatMap((group) => group.options));
  protected readonly activeId = computed(() => this.options()[this.active()]?.domId ?? null);
  /** The "try a spec ID like …" example: the first spec the palette knows, else 001. */
  protected readonly example = computed(() => this.index.workspaces()[0]?.specs[0]?.id ?? '001');

  constructor() {
    // Every open starts empty on the first option, and refreshes the cross-workspace index.
    effect(() => {
      if (!this.keyboard.paletteOpen()) return;
      untracked(() => {
        this.query.set('');
        this.active.set(0);
        this.index.want();
      });
    });
  }

  protected onInput(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
    this.active.set(0);
  }

  protected onKey(event: KeyboardEvent): void {
    const count = this.options().length;
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        event.preventDefault();
        if (count === 0) return;
        const step = event.key === 'ArrowDown' ? 1 : -1;
        this.select(Math.min(count - 1, Math.max(0, this.active() + step)));
        return;
      }
      case 'Enter': {
        if (!isCommitEnter(event)) return;
        const option = this.options().at(this.active());
        if (option === undefined) return;
        event.preventDefault();
        this.activate(option.entry);
        return;
      }
      default:
        return;
    }
  }

  protected select(index: number): void {
    this.active.set(index);
    const id = this.options().at(index)?.domId;
    if (id !== undefined) this.document.getElementById(id)?.scrollIntoView({ block: 'nearest' });
  }

  /** An action that drives a `DemoData` mock (spec 024): its row carries the demo chip. */
  protected isDemo(entry: PaletteEntry): boolean {
    return (entry as { demo?: unknown }).demo === true;
  }

  protected activate(entry: PaletteEntry): void {
    this.keyboard.paletteOpen.set(false);
    if (isCommand(entry)) {
      entry.run();
      return;
    }
    this.recent.remember(entry);
    void follow(this.router, entry);
  }
}
