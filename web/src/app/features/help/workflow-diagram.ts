// The Help page's workflow diagrams (spec 008, ISC-123): one mermaid `stateDiagram-v2` text per spec type, built from
// the workflow row the planning tree carries. The moves are core's (`rowTransitions`), never re-derived here, so the
// diagram shows exactly what the board would accept; this module only lays them out as text.
import type { WorkflowRow, WorkflowStage } from '../../../../../core/src/files';
import { rowTransitions } from '../../../../../core/src/stage';
import type { Tier } from '../../layout/shell/tier';

/** Left to right on the wide tier, top to bottom otherwise (design.md § Soll, Help). */
export type DiagramDirection = 'LR' | 'TB';

/** The words a diagram shows, from the catalogue so the active language applies. */
export interface DiagramLabels {
  readonly stage: (stage: WorkflowStage) => string;
  /** The edge into `build`: it needs the reviewed mark. */
  readonly gateReviewed: string;
  /** The edge into `done`: it needs every claim closed. */
  readonly gateClosed: string;
}

/** Which fixed gate a move passes: `reviewed` into build, `closed` into done, null for any other move. */
export type GateKind = 'reviewed' | 'closed';

export interface DiagramTransition {
  readonly from: WorkflowStage;
  readonly to: WorkflowStage;
  readonly gate: GateKind | null;
}

/** The two detours every type has and no row lists; drawn as side nodes. */
const DETOURS: readonly WorkflowStage[] = ['blocked', 'close-pending'];
/** The stages that carry the fixed gates (FORMAT.md § workflow): the review mark and the last stage. */
const GATE_STAGES: readonly WorkflowStage[] = ['review', 'done'];

export const diagramDirection = (tier: Tier): DiagramDirection => (tier === 'wide' ? 'LR' : 'TB');

const gateOf = (from: WorkflowStage, to: WorkflowStage): GateKind | null => {
  if (to === 'build' && from !== 'blocked') return 'reviewed';
  if (to === 'done') return 'closed';
  return null;
};

/** The row's moves in drawing order (the chain, then the detours), each flagged with the fixed gate it passes. */
export function transitionList(row: WorkflowRow): readonly DiagramTransition[] {
  return rowTransitions(row).map(({ from, to }) => ({ from, to, gate: gateOf(from, to) }));
}

/** A mermaid state id: stage names hold hyphens and words mermaid reserves, so every id is prefixed. */
const stateId = (stage: WorkflowStage): string => `s_${stage.replace(/-/g, '_')}`;
/** Label text without the characters that end a mermaid label or a statement. */
const clean = (text: string): string => text.replace(/[:;#"\r\n]/g, ' ');

/** The `stateDiagram-v2` text of one workflow row. */
export function workflowDiagram(row: WorkflowRow, direction: DiagramDirection, labels: DiagramLabels): string {
  const moves = transitionList(row);
  const detours = DETOURS.filter((stage) => moves.some((move) => move.from === stage || move.to === stage));
  const gates = GATE_STAGES.filter((stage) => row.stages.includes(stage));
  const first = row.stages.at(0);
  const last = row.stages.at(-1);
  const gateLabel = (gate: GateKind | null): string =>
    gate === null ? '' : ` : ${clean(gate === 'reviewed' ? labels.gateReviewed : labels.gateClosed)}`;
  const out = [
    'stateDiagram-v2',
    `direction ${direction}`,
    'classDef fixedGate stroke-width:3px',
    'classDef detour stroke-dasharray:4 4',
    ...[...row.stages, ...detours].map((stage) => `state "${clean(labels.stage(stage))}" as ${stateId(stage)}`),
    ...(first === undefined ? [] : [`[*] --> ${stateId(first)}`]),
    ...moves.map((move) => `${stateId(move.from)} --> ${stateId(move.to)}${gateLabel(move.gate)}`),
    ...(last === undefined ? [] : [`${stateId(last)} --> [*]`]),
    ...(gates.length === 0 ? [] : [`class ${gates.map(stateId).join(', ')} fixedGate`]),
    ...(detours.length === 0 ? [] : [`class ${detours.map(stateId).join(', ')} detour`]),
  ];
  return out.map((line, i) => (i === 0 ? line : `  ${line}`)).join('\n');
}
