import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  DOCUMENT,
  effect,
  ElementRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { map } from 'rxjs';
import { BoardStatesGallery } from './board-states-gallery';
import { StatesGallery } from './states-gallery';
import { TilesGallery } from './tiles-gallery';
import { UiButton, type ButtonTone, type ButtonVariant } from '../../shared/ui/button/button';
import { UiButtonGroup } from '../../shared/ui/button/button-group';
import { UiIconButton } from '../../shared/ui/button/icon-button';
import {
  type FilterOption,
  type MeterSegment,
  type SegmentedOption,
  type Tone,
  UiCard,
  UiChip,
  UiCommandChip,
  UiDialog,
  UiGlyph,
  UiStateChip,
  type ChipVariant,
  type GlyphFamily,
  type GlyphState,
  chipIcon,
  UiDisclosure,
  UiEmptyState,
  UiFilterChips,
  UiIdChip,
  UiKbd,
  UiKpiTile,
  UiLiveRegion,
  UiMeter,
  UiNotice,
  UiPopover,
  UiPopoverTrigger,
  UiRelativeTime,
  UiRing,
  UiRovingItem,
  UiRovingList,
  UiSectionHeader,
  UiSegmented,
  UiSheet,
  UiSkeleton,
  UiStageTrack,
  UiTerm,
} from '../../shared/ui';

/**
 * The primitives gallery at `/__ui` (T29): every shared primitive rendered at least once in every state with an
 * interactive or coloured surface, so the browser tier (focus, contrast, motion; ISC-64 to ISC-66) has a page to
 * measure before any dashboard exists. A dev surface, not a product screen:
 *
 * - `?theme=light|dark` forces `data-theme` (`spec-light` / `spec-dark`) on `<html>`; light when absent.
 * - `<body data-ready="true">` once the popover is open and the fonts are loaded (the fixtures' `awaitReady`).
 * - Every rendered primitive carries a stable `data-gallery="<primitive>[-<state>]"`, so specs address elements by
 *   name; the root is `data-ui="gallery"`.
 *
 * gallery: dev-only strings. The labels below are literal English on purpose: the page is never shown to a user and
 * the i18n parity guard checks only the keys passed to the `transloco` pipe. The route is lazy (app.routes.ts), so
 * none of this lands in the initial bundle.
 */
@Component({
  selector: 'app-ui-gallery',
  imports: [
    BoardStatesGallery,
    StatesGallery,
    TilesGallery,
    RouterLink,
    UiButton,
    UiButtonGroup,
    UiIconButton,
    UiCard,
    UiChip,
    UiCommandChip,
    UiDialog,
    UiGlyph,
    UiStateChip,
    UiDisclosure,
    UiEmptyState,
    UiFilterChips,
    UiIdChip,
    UiKbd,
    UiKpiTile,
    UiLiveRegion,
    UiMeter,
    UiNotice,
    UiPopover,
    UiPopoverTrigger,
    UiRelativeTime,
    UiRing,
    UiRovingItem,
    UiRovingList,
    UiSectionHeader,
    UiSegmented,
    UiSheet,
    UiSkeleton,
    UiStageTrack,
    UiTerm,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './ui-gallery.html',
  styleUrl: './ui-gallery.css',
})
export class UiGallery {
  protected readonly variants: readonly ButtonVariant[] = ['primary', 'secondary', 'ghost', 'outline'];
  protected readonly buttonTones: ReadonlyArray<ButtonTone | undefined> = [undefined, 'warning', 'danger'];
  protected readonly tones: readonly Tone[] = ['neutral', 'primary', 'secondary', 'accent', 'success', 'warning', 'error'];

  protected readonly filters: readonly FilterOption[] = [
    { key: 'all', label: 'All', count: 6 },
    { key: 'building', label: 'building', count: 2, tone: 'warning' },
    { key: 'scoping', label: 'scoping', count: 4, tone: 'secondary' },
  ];
  protected readonly filter = signal('building');

  protected readonly segments: readonly SegmentedOption[] = [
    { key: 'system', label: 'System' },
    { key: 'light', label: 'Light', tone: 'primary' },
    { key: 'dark', label: 'Dark', tone: 'secondary' },
  ];
  protected readonly segment = signal('light');

  // Prototype anatomy (ISC-148): the fixture's chip parts and the app chip that stands for each (primitives.spec.ts).
  protected readonly chipIcon = chipIcon;
  protected readonly anatomyChips: ReadonlyArray<{ part: string; tone: Tone; variant: ChipVariant; icon: ReturnType<typeof chipIcon> }> = [
    { part: 'chip', tone: 'neutral', variant: 'status', icon: chipIcon('lane-chip') },
    { part: 'chip-building', tone: 'primary', variant: 'status', icon: chipIcon('building') },
    { part: 'chip-scoping', tone: 'secondary', variant: 'status', icon: chipIcon('scoping') },
    { part: 'chip-done', tone: 'success', variant: 'status', icon: chipIcon('done') },
    { part: 'chip-stale', tone: 'warning', variant: 'status', icon: chipIcon('stale') },
    { part: 'chip-warn', tone: 'warning', variant: 'status', icon: chipIcon('warn') },
    { part: 'chip-plain', tone: 'neutral', variant: 'plain', icon: chipIcon('feature') },
    { part: 'chip-take', tone: 'accent', variant: 'take', icon: chipIcon('take') },
    { part: 'chip-mono-chip', tone: 'neutral', variant: 'mono', icon: undefined },
  ];
  protected readonly anatomyStates: ReadonlyArray<{ part: string; state: GlyphState; family: GlyphFamily }> = [
    { part: 'chip-st-closed', state: 'closed', family: 'claim' },
    { part: 'chip-st-takeable', state: 'takeable', family: 'claim' },
    { part: 'chip-st-taken', state: 'taken', family: 'claim' },
    { part: 'chip-st-blocked', state: 'blocked', family: 'claim' },
    { part: 'chip-st-concerns', state: 'concerns', family: 'card' },
    { part: 'chip-st-question', state: 'question', family: 'card' },
    { part: 'chip-st-fail', state: 'fail', family: 'card' },
  ];
  protected readonly anatomyPair: readonly SegmentedOption[] = [
    { key: 'a', label: 'Ag' },
    { key: 'b', label: 'Ag' },
  ];
  protected readonly anatomyPairValue = signal('a');

  protected readonly split: readonly MeterSegment[] = [
    { key: 'complete', count: 3, tone: 'accent' },
    { key: 'building', count: 2, tone: 'warning' },
    { key: 'scoping', count: 4, tone: 'secondary' },
    { key: 'held', count: 1, tone: 'neutral' },
  ];

  protected readonly stages = ['Plan', 'Tasks', 'Review', 'Build', 'Close'] as const;
  protected readonly rows = ['001 · App skeleton', '002 · Dashboard shell', '003 · Command palette', '004 · Refresh'];
  protected readonly updatedAt = Date.now() - 12_000;

  protected readonly dialogOpen = signal(false);
  protected readonly sheetOpen = signal(false);

  private readonly doc = inject(DOCUMENT);
  private readonly popover = viewChild.required<UiPopover>('popover');
  private readonly popoverTrigger = viewChild.required<string, ElementRef<HTMLElement>>('popoverTrigger', { read: ElementRef });
  private readonly theme = toSignal(
    inject(ActivatedRoute).queryParamMap.pipe(map((params) => (params.get('theme') === 'dark' ? 'dark' : 'light'))),
    { initialValue: 'light' },
  );

  constructor() {
    const html = this.doc.documentElement;
    const body = this.doc.body;
    effect(() => {
      html.setAttribute('data-theme', `spec-${this.theme()}`);
    });

    // Ready once the open popover is in the top layer and the fonts are in: the `toggle` event fires after the
    // platform has shown it, so no timeout or second render pass is guessed.
    afterNextRender(() => {
      const panel = this.popoverTrigger().nativeElement.parentElement?.querySelector('[popover]');
      const opened = new Promise<void>((resolve) => {
        if (!panel) {
          resolve();
          return;
        }
        panel.addEventListener('toggle', () => resolve(), { once: true });
      });
      this.popover().show(this.popoverTrigger().nativeElement);
      void Promise.all([opened, this.doc.fonts.ready]).then(() => body.setAttribute('data-ready', 'true'));
    });

    inject(DestroyRef).onDestroy(() => body.removeAttribute('data-ready'));
  }

  protected buttonName(variant: ButtonVariant, tone: ButtonTone | undefined): string {
    return tone ? `button-${variant}-${tone}` : `button-${variant}`;
  }
}
