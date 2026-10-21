import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import type { ItemStateInfo, Priority } from '../../../../../../core/src/files';
import { UiIcon } from '../../../shared/icons/icon';
import { UiItemState } from '../../../shared/ui/item-state/item-state';
import { PRIORITY_LOOK, UiPriority } from '../../../shared/ui/priority/priority';
import type { DashboardIdea } from './idea-rows';

/** The state line without a command: an idea's row carries no Next command (ISC-482); its page holds the chip. */
function withoutCommand(info: ItemStateInfo): ItemStateInfo {
  const { command, run, ...rest } = info;
  if (command === undefined && run === undefined) return info;
  return run === undefined ? rest : { ...rest, run: { ...run, command: null } };
}

/**
 * Spec 064 (T40, ISC-479, ISC-482): one story of `specs/ideas/` as a row of the Specs list, in the row grid of
 * `app-spec-row` (`_row-grid.css`: the same columns and heights per tier). Where a spec row has its id, the idea glyph;
 * then the title as the row link, stretched over the whole row, to `/w/<ws>/ideas/<slug>`, with feature and milestone
 * as the muted meta behind it; in the track cell `ui-priority` and, when the model serves one, `ui-item-state`
 * without its command and actor. The meter and star cells stay empty: an idea has no stage track, claim progress,
 * Next command or agent dot. Below 640 px of list it stacks like the spec row, the meta ending line 2.
 */
@Component({
  selector: 'app-idea-row',
  imports: [RouterLink, TranslocoPipe, UiIcon, UiItemState, UiPriority],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './idea-row.html',
  styleUrl: './idea-row.css',
  host: { '[attr.data-idea]': 'idea().slug', '[attr.data-desc]': "where() ? '' : null" },
})
export class IdeaRow {
  readonly idea = input.required<DashboardIdea>();
  /** The workspace slug the row links in. */
  readonly ws = input.required<string>();

  protected readonly link = computed(() => ['/w', this.ws(), 'ideas', this.idea().slug]);
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
}
