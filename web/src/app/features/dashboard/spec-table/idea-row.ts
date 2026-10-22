import { LocationStrategy } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { Router } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import type { Priority } from '../../../../../../core/src/files';
import type { RelationRef } from '../../../../../../core/src/relations';
import { DetailSelection, selectedLook } from '../../../layout/detail-sidebar/selection';
import { ShellData } from '../../../layout/shell/shell-data.service';
import { UiIcon } from '../../../shared/icons/icon';
import { UiChip } from '../../../shared/ui/chip/chip';
import { ITEM_GLYPHS } from '../../../shared/ui/glyph/states';
import type { Tone } from '../../../shared/ui/tone';
import { PRIORITY_LOOK, UiPriority } from '../../../shared/ui/priority/priority';
import { UiStarToggle } from '../../../shared/ui/star-toggle/star-toggle';
import type { DashboardIdea } from './idea-rows';

/**
 * Spec 064 (T40, ISC-484, ISC-482): one story of `specs/ideas/` as a row of the Specs list, in the row grid of
 * `app-spec-row` (`_row-grid.css`: the same ten named columns and heights per tier, T47). In `id` the idea glyph; in
 * `title` the title as the row link, stretched over the whole row, its href the idea page `/w/<ws>/ideas/<slug>`; in
 * `feature` the feature over the milestone, as a spec row's; in `prio` `ui-priority`; in `phase`, when the model serves
 * one, the state as the spec row's stage chip (`ui-chip` with a dot in the state's item-glyph tone, "Idea · open";
 * T69, ISC-510), without command or actor; in `star` the idea favourite's `ui-star-toggle` (T53, ISC-497),
 * its own target above the link. `more`, `mark`, `agent`, `track` and `meter` stay empty:
 * an idea has no stage track, claim progress, Next command or agent dot. Below 640 px it takes the spec row's two lines.
 *
 * The link activates like a spec row's (spec 026, ISC-171): a plain click (or Enter) selects the story for the detail
 * sidebar (`?sel=idea:<slug>`, every other param kept), the row taking the selection look; on the selected row it
 * opens the idea page. A Shift, Ctrl, Cmd or Alt click keeps the browser's own handling of the href.
 */
@Component({
  selector: 'app-idea-row',
  imports: [TranslocoPipe, UiChip, UiIcon, UiPriority, UiStarToggle],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './idea-row.html',
  styleUrl: './idea-row.css',
  host: { '[attr.data-idea]': 'idea().slug' },
})
export class IdeaRow {
  readonly idea = input.required<DashboardIdea>();
  /** The workspace slug the row links in. */
  readonly ws = input.required<string>();

  private readonly router = inject(Router);
  private readonly location = inject(LocationStrategy);
  private readonly selection = inject(DetailSelection);
  private readonly shell = inject(ShellData);

  private readonly link = computed(() => ['/w', this.ws(), 'ideas', this.idea().slug]);
  /** The idea page as the link's href, as RouterLink writes it, so a modified click or "copy link" reaches it. */
  protected readonly href = computed(() => this.location.prepareExternalUrl(this.router.serializeUrl(this.router.createUrlTree(this.link()))));
  /** The story's selection ref (contract rule 2) and its look while selected (rule 3). */
  protected readonly ref = computed<RelationRef>(() => `idea:${this.idea().slug}`);
  protected readonly look = computed(() => selectedLook(this.selection, this.ref(), 'row'));
  /** The title, or the slug for a story without one. */
  protected readonly title = computed(() => this.idea().title || this.idea().slug);
  /** The story's `priority:` as a level; anything else reads as the primitive's unmarked P3. */
  protected readonly priority = computed<Priority | null>(() => {
    const value = this.idea().priority;
    return Object.hasOwn(PRIORITY_LOOK, value) ? (value as Priority) : null;
  });
  protected readonly state = computed(() => this.idea().state ?? null);
  /** The pill's tone: the state's own in the item glyph family (open secondary, waiting neutral, running primary,
   *  aborted warning, done accent), so the pill and the state's glyph elsewhere read alike. */
  protected readonly stateTone = computed<Tone>(() => {
    const state = this.state();
    return state === null ? 'neutral' : ITEM_GLYPHS[state.state].tone;
  });
  /** Spec 064 (T53, ISC-497): whether the story is a favourite of the open workspace, as `ShellData` holds it. */
  protected readonly favorite = computed(() => this.shell.isIdeaFavorite(this.idea().slug));

  /** The star: sets or unsets the idea favourite; the click stays on the star, so the row is neither selected nor opened. */
  protected toggleFavorite(event: MouseEvent): void {
    event.stopPropagation();
    void this.shell.toggleIdeaFavorite(this.idea().slug);
  }

  /** A plain click or Enter: select the story, or on the selected row open its page; modified clicks stay native. */
  protected activate(event: MouseEvent): void {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    event.preventDefault();
    if (this.look() === null) void this.selection.select(this.ref());
    else void this.router.navigate(this.link());
  }
}
