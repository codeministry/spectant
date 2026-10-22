import { LocationStrategy } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { Router } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import type { ItemStateInfo, Priority } from '../../../../../../core/src/files';
import type { RelationRef } from '../../../../../../core/src/relations';
import { DetailSelection, selectedLook } from '../../../layout/detail-sidebar/selection';
import { ShellData } from '../../../layout/shell/shell-data.service';
import { UiIcon } from '../../../shared/icons/icon';
import { UiItemState } from '../../../shared/ui/item-state/item-state';
import { PRIORITY_LOOK, UiPriority } from '../../../shared/ui/priority/priority';
import { UiStarToggle } from '../../../shared/ui/star-toggle/star-toggle';
import type { DashboardIdea } from './idea-rows';

/** The state line without a command: an idea's row carries no Next command (ISC-482); its page holds the chip. */
function withoutCommand(info: ItemStateInfo): ItemStateInfo {
  const { command, run, ...rest } = info;
  if (command === undefined && run === undefined) return info;
  return run === undefined ? rest : { ...rest, run: { ...run, command: null } };
}

/**
 * Spec 064 (T40, ISC-484, ISC-482): one story of `specs/ideas/` as a row of the Specs list, in the row grid of
 * `app-spec-row` (`_row-grid.css`: the same ten named columns and heights per tier, T47). In `id` the idea glyph; in
 * `title` the title as the row link, stretched over the whole row, its href the idea page `/w/<ws>/ideas/<slug>`, with
 * feature and milestone as the muted description behind it; in `prio` `ui-priority`; in `phase`, when the model serves
 * one, `ui-item-state` without its command and actor; in `star` the idea favourite's `ui-star-toggle` (T53, ISC-497),
 * its own target above the link. `more`, `mark`, `agent`, `track` and `meter` stay empty:
 * an idea has no stage track, claim progress, Next command or agent dot. Below 640 px it takes the spec row's two lines.
 *
 * The link activates like a spec row's (spec 026, ISC-171): a plain click (or Enter) selects the story for the detail
 * sidebar (`?sel=idea:<slug>`, every other param kept), the row taking the selection look; on the selected row it
 * opens the idea page. A Shift, Ctrl, Cmd or Alt click keeps the browser's own handling of the href.
 */
@Component({
  selector: 'app-idea-row',
  imports: [TranslocoPipe, UiIcon, UiItemState, UiPriority, UiStarToggle],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './idea-row.html',
  styleUrl: './idea-row.css',
  host: { '[attr.data-idea]': 'idea().slug', '[attr.data-desc]': "where() ? '' : null" },
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
  /** Feature and milestone, whichever the story names, joined by a middle dot; empty for neither. */
  protected readonly where = computed(() => {
    const { feature, milestone } = this.idea();
    return [feature, milestone].filter((part): part is string => part !== null && part !== '').join(' · ');
  });
  protected readonly state = computed(() => {
    const state = this.idea().state;
    return state === undefined ? null : withoutCommand(state);
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
