import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, DOCUMENT, effect, inject, signal, untracked } from '@angular/core';
import { Router } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { keyLabel } from '../../core/keyboard-bindings';
import { KeyboardService } from '../../core/keyboard.service';
import { PALETTE_SOURCES, type PaletteEntry, type PaletteSource } from '../../core/palette-sources';
import { UiIcon } from '../../shared/icons/icon';
import { UiKbd } from '../../shared/ui/kbd/kbd';
import { UiDialog } from '../../shared/ui/overlay/dialog';
import { nextId } from '../../shared/ui/overlay/ids';
import { UiSheet } from '../../shared/ui/overlay/sheet';
import { ShellState } from '../shell/shell-state.service';
import { isCommand } from './palette-groups';
import { PaletteIndex } from './palette-index';
import { highlight, rankEntries, type Segment } from './palette-ranking';
import { PaletteRecent } from './palette-recent';

interface PaletteOption {
  readonly entry: PaletteEntry;
  /** Position in the flat option order the arrows walk. */
  readonly index: number;
  readonly domId: string;
  readonly label: readonly Segment[];
  readonly chip: readonly Segment[];
}

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
 * the query filters to nothing, renders no heading at all. Recent shows only for an empty query. With a query the
 * groups follow their best match, so Enter lands on it (ranking in palette-ranking.ts).
 *
 * Opened by ⌘K / Ctrl+K / `/` and the header trigger through `KeyboardService.paletteOpen`; mounted once by the app
 * root and deferred until the first open. Enter on a navigating entry follows its link and remembers it as recent; a
 * command entry runs. Focus returns to the opener on close (modal.ts).
 */
@Component({
  selector: 'app-command-palette',
  imports: [NgTemplateOutlet, TranslocoPipe, UiDialog, UiIcon, UiKbd, UiSheet],
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
  private readonly sources: readonly PaletteSource[] = [...(inject(PALETTE_SOURCES, { optional: true }) ?? [])].sort(
    (a, b) => a.order - b.order,
  );

  protected readonly listId = nextId('palette-list');
  protected readonly escLabel = keyLabel('Escape');
  protected readonly compact = computed(() => this.shell.tier() === 'compact');
  protected readonly query = signal('');
  protected readonly active = signal(0);

  protected readonly groups = computed<readonly PaletteGroup[]>(() => {
    const query = this.query().trim();
    const ranked = this.sources
      .filter((source) => query === '' || source.id !== 'recent')
      .map((source) => ({ source, matches: rankEntries(source.entries(), query) }))
      .filter((group) => group.matches.length > 0);
    if (query !== '') ranked.sort((a, b) => (b.matches[0]?.rank ?? 0) - (a.matches[0]?.rank ?? 0) || a.source.order - b.source.order);
    let index = 0;
    return ranked.map(({ source, matches }) => ({
      id: source.id,
      labelKey: source.labelKey,
      headingId: `${this.listId}-${source.id}`,
      options: matches.map(({ entry }) => {
        const at = index++;
        return {
          entry,
          index: at,
          domId: `${this.listId}-o${String(at)}`,
          label: highlight(entry.label, query),
          chip: highlight(entry.chip ?? '', query),
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

  protected activate(entry: PaletteEntry): void {
    this.keyboard.paletteOpen.set(false);
    if (isCommand(entry)) {
      entry.run();
      return;
    }
    this.recent.remember(entry);
    const link = entry.link;
    void (typeof link === 'string' ? this.router.navigateByUrl(link) : this.router.navigate([...link]));
  }
}
