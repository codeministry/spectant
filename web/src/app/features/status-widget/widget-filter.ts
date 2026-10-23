import type { Stage } from '../../../../../core/src/stage';
import type { StatusResponse, StatusSpec, StatusWorkspace } from '../../../../../server/src/contracts/status.contract';
import { STAGE_ORDER } from '../../shared/ui/stage-tone';

/**
 * The status widget's filter (spec 072, T17, ISC-603): two multi-selections over the listed specs, workspace and
 * stage, held as pure functions over the status body. No Angular, no translation, no storage: the page renders the
 * options with their words and feeds `visibleGroups` into its list and its KPIs.
 *
 * The options always come from the unfiltered body, so a toggle never removes the chip under the focus (design.md §
 * Desktop "Stabile Optionen"): workspaces in the body's (the picker's) order, stages in workflow order
 * (`STAGE_ORDER`) limited to the ones that occur, so a live update never reorders them.
 */

/** The selection: workspace slugs and stages; an empty list selects nothing and so matches everything. */
export interface WidgetFilter {
  readonly workspaces: readonly string[];
  readonly stages: readonly Stage[];
}

/** No selection in either dimension: every listed spec and every unreadable workspace shows. */
export const EMPTY_FILTER: WidgetFilter = { workspaces: [], stages: [] };

/** One workspace option: its slug as the key, the path tail the group head shows, and whether it could be read. */
export interface WorkspaceOption {
  readonly key: string;
  readonly pathTail: string;
  readonly readable: boolean;
}

/** Whether a workspace has a group in the unfiltered list: it lists a spec, or it is unreadable (ISC-584, ISC-588). */
const hasGroup = (ws: StatusWorkspace): boolean => !ws.readable || ws.specs.length > 0;

/** The workspace options: each that lists a spec and each unreadable one, in body (picker) order. */
export function workspaceOptions(body: StatusResponse): readonly WorkspaceOption[] {
  return body.workspaces.filter(hasGroup).map((ws) => ({ key: ws.slug, pathTail: ws.pathTail, readable: ws.readable }));
}

/** The stage options: the stages that occur among the listed specs, in workflow order. */
export function stageOptions(body: StatusResponse): readonly Stage[] {
  const occurring = new Set<Stage>(body.workspaces.flatMap((ws) => ws.specs.map((spec) => spec.stage)));
  return STAGE_ORDER.filter((stage) => occurring.has(stage));
}

/** Whether a workspace passes the workspace selection; an empty selection passes every one. */
const workspaceMatches = (filter: WidgetFilter, slug: string): boolean =>
  filter.workspaces.length === 0 || filter.workspaces.includes(slug);

/** Whether a spec passes the stage selection; an empty selection passes every one. */
const stageMatches = (filter: WidgetFilter, spec: StatusSpec): boolean =>
  filter.stages.length === 0 || filter.stages.includes(spec.stage);

/**
 * The groups to render, in body order, each with its specs narrowed to the rows that match both selections. A
 * readable workspace without a matching row has no head. An unreadable workspace stays while the workspace selection
 * is empty or contains it; a stage selection never hides it, since it lists nothing a stage could match.
 */
export function visibleGroups(body: StatusResponse, filter: WidgetFilter): readonly StatusWorkspace[] {
  const groups: StatusWorkspace[] = [];
  for (const ws of body.workspaces) {
    if (!workspaceMatches(filter, ws.slug)) continue;
    if (!ws.readable) {
      groups.push(ws);
      continue;
    }
    const specs = ws.specs.filter((spec) => stageMatches(filter, spec));
    if (specs.length > 0) groups.push(specs.length === ws.specs.length ? ws : { ...ws, specs });
  }
  return groups;
}
