import { afterRenderEffect, ChangeDetectionStrategy, Component, ElementRef, inject } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import type { ClaimGlyphState, ClaimView } from '../../../../../../../core/src/files';
import { ShellState } from '../../../../layout/shell/shell-state.service';
import { UiIcon } from '../../../../shared/icons/icon';
import { UiButton } from '../../../../shared/ui/button/button';
import { UiChip } from '../../../../shared/ui/chip/chip';
import { chipIcon } from '../../../../shared/ui/chip/chip-icons';
import { UiEmptyState } from '../../../../shared/ui/empty-state/empty-state';
import { UiFilterChips } from '../../../../shared/ui/filter-chips/filter-chips';
import { UiIdChip } from '../../../../shared/ui/id-chip/id-chip';
import { UiItemState } from '../../../../shared/ui/item-state/item-state';
import { type RelativeFormat, UiRelativeTime } from '../../../../shared/ui/relative-time/relative-time';
import { UiRovingItem, UiRovingList } from '../../../../shared/ui/roving-list.directive';
import { UiSectionHeader } from '../../../../shared/ui/section-header/section-header';
import { type Tone, toneMark } from '../../../../shared/ui/tone';
import { UiWaitsChip } from '../../../../shared/ui/waits-chip/waits-chip';
import { ClaimsStore } from './claims.store';

/** One glyph per state; blocked shares open's ring and adds a chip, taken adds the lock chip and its session
 * (spec 001 prompt 2); the template draws taken as the lucide `lock` (spec 024). */
const GLYPH: Record<ClaimGlyphState, string> = {
  open: '○',
  takeable: '◐',
  taken: '◉',
  blocked: '○',
  closed: '●',
  dropped: '⛔',
};

const SEVERITY: Partial<Record<string, Tone>> = { critical: 'error', high: 'error', medium: 'warning', low: 'neutral' };

/** A file a verification line names (`.evidence/isc-5/list.png`), relative to `.evidence/`; null for a command. */
const FILE = /(?:^|[\s`'"(])((?:\.evidence\/)?[\w.-]+(?:\/[\w.-]+)*\.(?:png|jpe?g|webp|gif|svg|txt|log|md|json|html?|pdf|har|pcapng|webm|mp4|zip|csv|xml|ya?ml))(?=$|[\s`'"),.;:])/i;

export function evidenceFile(line: string | null): string | null {
  const match = line === null ? null : FILE.exec(line);
  return match?.[1]?.replace(/^\.evidence\//, '') ?? null;
}

/**
 * The Claims tab (ISC-81): every claim of the spec as a card grouped under its feature heading, with its state glyph,
 * kind, dependency edges, probe row, verification line and note count, filterable by state, kind and search (all in
 * the URL: `?state=takeable&kind=anti&q=…`), the fog list at the end. Counts are the payload's `counts`, never
 * recounted here (ISC-72). `#claim-ISC-…` scrolls to, focuses and highlights its card. The state lives in
 * `ClaimsStore` (spec 061), one per tab; the page keeps the deep-link scroll and the card's presentation helpers.
 */
@Component({
  selector: 'app-claims-tab',
  imports: [
    NgTemplateOutlet,
    RouterLink,
    TranslocoPipe,
    UiButton,
    UiChip,
    UiEmptyState,
    UiFilterChips,
    UiIcon,
    UiIdChip,
    UiItemState,
    UiRelativeTime,
    UiRovingItem,
    UiRovingList,
    UiSectionHeader,
    UiWaitsChip,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-view': 'claims' },
  templateUrl: './claims-tab.html',
  styleUrls: ['./claims-tab.css', './claims-tab-card.css'],
  providers: [ClaimsStore],
})
export class ClaimsTab {
  protected readonly store = inject(ClaimsStore);
  protected readonly shell = inject(ShellState);
  protected readonly chipIcon = chipIcon;
  private readonly transloco = inject(TranslocoService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  protected readonly glyph = GLYPH;
  protected readonly evidenceFile = evidenceFile;

  protected readonly elapsed: RelativeFormat = (value, unit) => {
    const label: string = this.transloco.translate(`claims.units.${unit}`);
    return this.transloco.translate('claims.taken.elapsed', { value, unit: label });
  };

  private scrolledTo: string | null = null;

  constructor() {
    // Scroll to and focus the deep-linked card once it is rendered; a later fragment scrolls again.
    afterRenderEffect(() => {
      const target = this.store.target();
      this.store.groups();
      if (target === null || target === this.scrolledTo) return;
      const card = this.host.querySelector<HTMLElement>(`[data-claim="${CSS.escape(target)}"]`);
      if (!card) return;
      this.scrolledTo = target;
      const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
      (card as Partial<HTMLElement>).scrollIntoView?.({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
      card.focus({ preventScroll: true });
    });
  }

  protected severityColor(severity: string): string | null {
    const tone: Tone | undefined = SEVERITY[severity.trim().toLowerCase()];
    return tone ? toneMark(tone) : null;
  }

  /** Backticks as written in spec.md are markup, not text. */
  protected plain(text: string): string {
    return text.replace(/`/g, '');
  }

  protected setSearch(event: Event): void {
    this.store.setSearch((event.target as HTMLInputElement).value);
  }

  protected glyphOf(claim: ClaimView): string {
    return this.glyph[claim.state];
  }
}
