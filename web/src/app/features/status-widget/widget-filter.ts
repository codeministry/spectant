import type { Stage } from '../../../../../core/src/stage';
import type { StatusResponse, StatusSpec, StatusWorkspace } from '../../../../../server/src/contracts/status.contract';
import { STAGE_ORDER } from '../../shared/ui/stage-tone';

/**
 * The status widget's filter (spec 072, T17, ISC-603): two multi-selections over the listed specs, workspace and
 * stage, held as pure functions over the status body. No Angular, no translation: the page renders the options with
 * their words and feeds `visibleGroups` into its list and its KPIs; it loads, saves and prunes the selection through
 * the storage helpers below (T27, ISC-606).
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

/**
 * The `localStorage` key of the filter selection (spec 072, T27, ISC-606), next to the window's
 * `spectant.statusWidget.bounds`: a per-viewer convenience (web/CLAUDE.md § State), so every access is wrapped and a
 * missing, unreadable or throwing store starts the filter without a selection.
 */
export const WIDGET_FILTER_KEY = 'spectant.statusWidget.filter';

const isStage = (value: unknown): value is Stage =>
  typeof value === 'string' && (STAGE_ORDER as readonly string[]).includes(value);

const isStringList = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

/** The stored selection, or `EMPTY_FILTER` when none is stored, it is not two lists of words, or the store throws. */
export function loadWidgetFilter(win: Window = window): WidgetFilter {
  try {
    const raw = win.localStorage.getItem(WIDGET_FILTER_KEY);
    if (raw === null) return EMPTY_FILTER;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return EMPTY_FILTER;
    const { workspaces, stages } = parsed as Partial<Record<keyof WidgetFilter, unknown>>;
    if (!isStringList(workspaces) || !Array.isArray(stages) || !stages.every(isStage)) return EMPTY_FILTER;
    return { workspaces: [...workspaces], stages: [...stages] };
  } catch {
    return EMPTY_FILTER;
  }
}

/** Stores the selection; a full or blocked store only loses the convenience. */
export function saveWidgetFilter(filter: WidgetFilter, win: Window = window): void {
  try {
    win.localStorage.setItem(WIDGET_FILTER_KEY, JSON.stringify({ workspaces: filter.workspaces, stages: filter.stages }));
  } catch {
    // Nothing to do: the next load starts without a selection.
  }
}

/**
 * The selection limited to the options the body still offers (a live update, ISC-587): a vanished workspace or a
 * stage no listed spec has anymore falls out. Returns the same object when nothing fell out, so a caller can skip
 * the write.
 */
export function pruneFilter(filter: WidgetFilter, body: StatusResponse): WidgetFilter {
  const keys = new Set(workspaceOptions(body).map((option) => option.key));
  const occurring = new Set(stageOptions(body));
  const workspaces = filter.workspaces.filter((slug) => keys.has(slug));
  const stages = filter.stages.filter((stage) => occurring.has(stage));
  if (workspaces.length === filter.workspaces.length && stages.length === filter.stages.length) return filter;
  return { workspaces, stages };
}

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
