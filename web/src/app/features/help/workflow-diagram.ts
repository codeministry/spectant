// The Help page's workflow figures (spec 008, ISC-123, T161): one layout model per spec type, built from the workflow
// row the planning tree carries and drawn as an inline SVG by `app-workflow-figure`. The moves are core's
// (`rowTransitions`), never re-derived here, so the figure shows exactly what the board would accept; this module only
// places them. Pure: the same row and words give the same model, so the specs assert geometry, not markup.
//
// Left to right at every tier: the stages in table order on one line, the build ⇄ blocked loop and the close-pending
// branch as arcs under it, each fixed gate a double-framed node with a shield-check annotation above it. The optional
// steps that move no stage (`optionalSteps`) are dotted: the design pass before the first stage on the line, a
// voluntary code review under it between build and what follows, where the row has no code-review stage.
import type { SpecType, WorkflowRow, WorkflowStage } from '../../../../../core/src/files';
import { rowTransitions } from '../../../../../core/src/stage';
import { ICONS } from '../../shared/icons/icons';

/** The words a figure shows, from the catalogue so the active language applies. */
export interface DiagramLabels {
  readonly stage: (stage: WorkflowStage) => string;
  /** The design pass's name, which is no stage. */
  readonly design: string;
  /** An optional step's node label from its name, e.g. `Design (optional)`. */
  readonly optional: (name: string) => string;
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

/** A step a figure draws: a stage of the row, or the design pass, an optional step that is no stage. */
export type FigureStep = WorkflowStage | 'design';

/**
 * An optional step: it moves no stage, so core's moves do not list it. `design` is the design pass (`/spec-design`,
 * design.md) before the row's first stage; `code-review` a voluntary `/spec-code-review` between build and the stage
 * after it, where the row has no code-review stage (`code_review: none`, or a hand-built row without it).
 */
export interface OptionalStep {
  readonly step: 'design' | 'code-review';
  /** The stage the step follows; null for the design pass, which comes before the first stage. */
  readonly from: WorkflowStage | null;
  readonly to: WorkflowStage;
}

/** The types the Spec skill's design pass refuses (its `SpecDesign.ts gate`): no viewport to design. */
const NO_DESIGN: ReadonlySet<SpecType> = new Set<SpecType>(['spike', 'infra']);

/** The optional steps of a row, in drawing order: the design pass first, then the voluntary code review. */
export function optionalSteps(row: WorkflowRow): readonly OptionalStep[] {
  const steps: OptionalStep[] = [];
  const first = row.stages.at(0);
  if (first !== undefined && !NO_DESIGN.has(row.type)) steps.push({ step: 'design', from: null, to: first });
  const after = row.stages.at(row.stages.indexOf('build') + 1);
  if (!row.stages.includes('code-review') && row.stages.includes('build') && after !== undefined) steps.push({ step: 'code-review', from: 'build', to: after });
  return steps;
}

/** What a stage does on the board, which picks its left edge: the legend's moving, waits on you, done and detour. */
export type StageRole = 'idea' | 'queued' | 'moving' | 'waits' | 'detour' | 'done' | 'optional';

const ROLE: Readonly<Record<WorkflowStage, StageRole>> = {
  idea: 'idea',
  plan: 'queued',
  tasks: 'queued',
  review: 'waits',
  'code-review': 'waits',
  close: 'waits',
  build: 'moving',
  blocked: 'detour',
  'close-pending': 'detour',
  done: 'done',
};

/** The role's edge token for the legend: build, review and done match the board's cards (`CARD_EDGE`, board-card.ts). */
export const ROLE_EDGE: Readonly<Record<StageRole, string>> = {
  idea: 'var(--teal)',
  queued: 'var(--track)',
  moving: 'var(--color-primary)',
  waits: 'var(--color-secondary)',
  detour: 'var(--held)',
  done: 'var(--color-accent)',
  optional: 'var(--track)',
};

/**
 * A node's left edge per stage: the same token the board's card carries (`CARD_EDGE`, board-card.ts), held equal by
 * the spec. Spec 024: the prototype board colours a blocked column red, so blocked leaves its detour role's grey.
 */
export const STAGE_EDGE: Readonly<Record<WorkflowStage, string>> = {
  ...(Object.fromEntries(Object.entries(ROLE).map(([stage, role]) => [stage, ROLE_EDGE[role]])) as Record<WorkflowStage, string>),
  blocked: 'var(--color-error)',
};

export const roleOf = (stage: WorkflowStage): StageRole => ROLE[stage];

/** The geometry, in SVG user units (px at 1:1). */
export const FIGURE = {
  pad: 16,
  /** The band above the main line that holds the gate annotations. */
  band: 24,
  nodeWidth: 104,
  nodeHeight: 32,
  gap: 40,
  /** From the main line's bottom to the detours' top. */
  drop: 40,
  blockedWidth: 112,
  pendingWidth: 168,
  /** An optional step's node: wide enough for its `(optional)` suffix in German. */
  optionalWidth: 176,
  iconSize: 12,
  /** The gate label's font size; its width is estimated from it, for the canvas size only. */
  gateFont: 11,
  arrowLength: 7,
  arrowWidth: 4,
} as const;

export interface FigureNode {
  readonly stage: FigureStep;
  readonly label: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** Drawn under the main line: `blocked`, `close-pending` and the optional code review. */
  readonly detour: boolean;
  /** An optional step (`optionalSteps`): drawn dotted, it moves no stage. */
  readonly optional: boolean;
  /** The fixed gate a move into this node passes: drawn with a double frame. */
  readonly gate: GateKind | null;
  readonly role: StageRole;
  /** The left edge's colour token. */
  readonly edge: string;
  readonly textX: number;
  readonly textY: number;
}

/**
 * `main` a step of the chain, `gate` a step through a fixed gate, `loop` build ⇄ blocked, `branch` via close-pending,
 * `optional` into or out of an optional step.
 */
export type EdgeKind = 'main' | 'gate' | 'loop' | 'branch' | 'optional';

export interface FigureEdge {
  readonly from: FigureStep;
  readonly to: FigureStep;
  readonly kind: EdgeKind;
  /** The line up to the arrowhead's base: `M … L …` for a step, `M … Q …` for an arc. */
  readonly path: string;
  /** The arrowhead: a triangle's three points, tip first. */
  readonly head: string;
}

export interface FigureGate {
  readonly kind: GateKind;
  /** The gated node. */
  readonly stage: FigureStep;
  readonly label: string;
  /** The shield-check glyph's top-left corner; it is `FIGURE.iconSize` square. */
  readonly iconX: number;
  readonly iconY: number;
  /** The label's start and its vertical centre. */
  readonly textX: number;
  readonly textY: number;
}

export interface WorkflowLayout {
  readonly nodes: readonly FigureNode[];
  readonly edges: readonly FigureEdge[];
  readonly gates: readonly FigureGate[];
  readonly size: { readonly width: number; readonly height: number };
}

/** The shield-check glyph's path data from the pinned icon set, drawn inline inside the figure's own SVG. */
export const SHIELD_CHECK: readonly string[] = [...ICONS['shield-check'].matchAll(/\bd="([^"]+)"/g)].map((m) => m[1]);

const gateOf = (from: WorkflowStage, to: WorkflowStage): GateKind | null => {
  if (to === 'build' && from !== 'blocked') return 'reviewed';
  if (to === 'done') return 'closed';
  return null;
};

/** The row's moves in drawing order (the chain, then the detours), each flagged with the fixed gate it passes. */
export function transitionList(row: WorkflowRow): readonly DiagramTransition[] {
  return rowTransitions(row).map(({ from, to }) => ({ from, to, gate: gateOf(from, to) }));
}

interface Point {
  readonly x: number;
  readonly y: number;
}

const num = (n: number): string => String(Math.round(n * 100) / 100);
const pt = (p: Point): string => `${num(p.x)} ${num(p.y)}`;

/** The arrowhead at `tip`, pointing along `towards → tip`, and where the line under it ends. */
function arrow(towards: Point, tip: Point): { base: Point; head: string } {
  const dx = tip.x - towards.x;
  const dy = tip.y - towards.y;
  const length = Math.hypot(dx, dy) || 1;
  const ux = dx / length;
  const uy = dy / length;
  const base = { x: tip.x - FIGURE.arrowLength * ux, y: tip.y - FIGURE.arrowLength * uy };
  const side = (s: number): string => `${num(base.x - s * FIGURE.arrowWidth * uy)},${num(base.y + s * FIGURE.arrowWidth * ux)}`;
  return { base, head: `${num(tip.x)},${num(tip.y)} ${side(1)} ${side(-1)}` };
}

const straight = (from: Point, tip: Point): Pick<FigureEdge, 'path' | 'head'> => {
  const { base, head } = arrow(from, tip);
  return { path: `M${pt(from)} L${pt(base)}`, head };
};

/** A quadratic arc; the arrowhead follows the curve's tangent at its end (`control → tip`). */
const arc = (from: Point, control: Point, tip: Point): Pick<FigureEdge, 'path' | 'head'> => {
  const { base, head } = arrow(control, tip);
  return { path: `M${pt(from)} Q${pt(control)} ${pt(base)}`, head };
};

const right = (n: FigureNode): number => n.x + n.width;
const bottom = (n: FigureNode): number => n.y + n.height;
const centreX = (n: FigureNode): number => n.x + n.width / 2;
const centreY = (n: FigureNode): number => n.y + n.height / 2;

/** The layout model of one workflow row: nodes, edges, gate annotations and the canvas size. */
export function workflowLayout(row: WorkflowRow, labels: DiagramLabels): WorkflowLayout {
  const moves = transitionList(row);
  const gateInto = new Map<WorkflowStage, GateKind>();
  for (const move of moves) if (move.gate !== null && !gateInto.has(move.to)) gateInto.set(move.to, move.gate);

  const optional = optionalSteps(row);
  const design = optional.find((o) => o.step === 'design');
  const review = optional.find((o) => o.step === 'code-review');

  const mainY = FIGURE.pad + FIGURE.band;
  const detourY = mainY + FIGURE.nodeHeight + FIGURE.drop;
  const makeNode = (stage: FigureStep, x: number, y: number, width: number, detour: boolean, isOptional = false): FigureNode => {
    const role = isOptional || stage === 'design' ? 'optional' : roleOf(stage);
    const name = stage === 'design' ? labels.design : labels.stage(stage);
    return {
      stage,
      label: isOptional ? labels.optional(name) : name,
      x,
      y,
      width,
      height: FIGURE.nodeHeight,
      detour,
      optional: isOptional,
      gate: detour || isOptional || stage === 'design' ? null : (gateInto.get(stage) ?? null),
      role,
      edge: stage === 'design' || isOptional ? ROLE_EDGE.optional : STAGE_EDGE[stage],
      // The 3 px edge bar sits at the left, so the label centres in the room right of it.
      textX: x + width / 2 + 4,
      textY: y + FIGURE.nodeHeight / 2,
    };
  };

  // The design pass leads the line, dotted; the stages follow one slot each.
  const lead = design ? [makeNode('design', FIGURE.pad, mainY, FIGURE.optionalWidth, false, true)] : [];
  const start = FIGURE.pad + (design ? FIGURE.optionalWidth + FIGURE.gap : 0);
  const main = [...lead, ...row.stages.map((stage, i) => makeNode(stage, start + i * (FIGURE.nodeWidth + FIGURE.gap), mainY, FIGURE.nodeWidth, false))];
  const byStage = new Map<FigureStep, FigureNode>(main.map((n) => [n.stage, n]));
  const build = byStage.get('build');
  const used = new Set(moves.flatMap((m) => [m.from, m.to]));
  const detours: FigureNode[] = [];
  if (build && used.has('blocked')) {
    const blocked = makeNode('blocked', centreX(build) - FIGURE.blockedWidth / 2, detourY, FIGURE.blockedWidth, true);
    detours.push(blocked);
    // Close-pending only where a move leads into it (`code_review: feature`); its way out alone is no reason to draw it.
    const branch = moves.some((m) => m.to === 'close-pending') ? 'close-pending' : review ? 'code-review' : null;
    if (branch !== null) {
      const target = branch === 'close-pending' ? byStage.get('code-review') : review && byStage.get(review.to);
      const width = branch === 'close-pending' ? FIGURE.pendingWidth : FIGURE.optionalWidth;
      const slot = centreX(build) + FIGURE.nodeWidth + FIGURE.gap;
      const wanted = (target ? Math.max(centreX(target), slot) : slot) - width / 2;
      detours.push(makeNode(branch, Math.max(wanted, right(blocked) + FIGURE.pad), detourY, width, true, branch === 'code-review'));
    }
  }
  for (const n of detours) byStage.set(n.stage, n);

  const edges: FigureEdge[] = [];
  for (const move of moves) {
    const from = byStage.get(move.from);
    const to = byStage.get(move.to);
    if (!from || !to || from.optional || to.optional) continue;
    edges.push({ from: move.from, to: move.to, ...edgeGeometry(from, to), kind: edgeKind(move, from, to) });
  }
  // The optional steps' edges: into the first stage from the design pass, through the voluntary code review.
  const link = (fromStep: FigureStep, toStep: FigureStep): void => {
    const from = byStage.get(fromStep);
    const to = byStage.get(toStep);
    if (from && to) edges.push({ from: fromStep, to: toStep, ...edgeGeometry(from, to), kind: 'optional' });
  };
  if (design) link('design', design.to);
  if (review?.from && byStage.get('code-review')?.optional === true) {
    link(review.from, 'code-review');
    link('code-review', review.to);
  }

  const gates: FigureGate[] = main.flatMap((n, i): FigureGate[] => {
    if (n.gate === null) return [];
    const previous = i === 0 ? undefined : main.at(i - 1);
    const iconX = previous ? right(previous) + 4 : n.x;
    const iconY = mainY - 8 - FIGURE.iconSize;
    return [
      {
        kind: n.gate,
        stage: n.stage,
        label: n.gate === 'reviewed' ? labels.gateReviewed : labels.gateClosed,
        iconX,
        iconY,
        textX: iconX + FIGURE.iconSize + 4,
        textY: iconY + FIGURE.iconSize / 2,
      },
    ];
  });

  const nodes = [...main, ...detours];
  // A label's width is not measurable here; 0.6 em a character over-estimates it, which only widens the margin.
  const textEnds = gates.map((g) => g.textX + g.label.length * FIGURE.gateFont * 0.6);
  const width = Math.ceil(Math.max(0, ...nodes.map(right), ...textEnds) + FIGURE.pad);
  const height = (detours.length > 0 ? detourY + FIGURE.nodeHeight : mainY + FIGURE.nodeHeight) + FIGURE.pad;
  return { nodes, edges, gates, size: { width, height } };
}

function edgeKind(move: DiagramTransition, from: FigureNode, to: FigureNode): EdgeKind {
  if (from.optional || to.optional) return 'optional';
  if (move.gate !== null) return 'gate';
  if (from.stage === 'blocked' || to.stage === 'blocked') return 'loop';
  if (from.detour || to.detour) return 'branch';
  return 'main';
}

/** Where one move runs: a step along the line, or an arc under it to and from a detour. */
function edgeGeometry(from: FigureNode, to: FigureNode): Pick<FigureEdge, 'path' | 'head'> {
  if (!from.detour && !to.detour) {
    // The chain, left to right; a backward pair (none in a row's moves) still reads as an arrow along the line.
    const leftToRight = from.x < to.x;
    return straight(
      { x: leftToRight ? right(from) + 2 : from.x - 2, y: centreY(from) },
      { x: leftToRight ? to.x - 2 : right(to) + 2, y: centreY(to) },
    );
  }
  if (to.stage === 'blocked') {
    // Down from build on the left of its centre, bowing outwards.
    const x = centreX(from) - 16;
    return arc({ x, y: bottom(from) + 2 }, { x: x - 20, y: (bottom(from) + to.y) / 2 }, { x, y: to.y - 2 });
  }
  if (from.stage === 'blocked') {
    // Back up into build on the right of its centre.
    const x = centreX(to) + 16;
    return arc({ x, y: from.y - 2 }, { x: x + 20, y: (bottom(to) + from.y) / 2 }, { x, y: bottom(to) + 2 });
  }
  if (to.detour) {
    // Into close-pending: down from build's right end, arriving at the detour's left side.
    const start = { x: right(from) - 10, y: bottom(from) + 2 };
    return arc(start, { x: start.x, y: centreY(to) }, { x: to.x - 2, y: centreY(to) });
  }
  // Out of close-pending, up into the stage it returns to (code-review).
  const tip = { x: centreX(to) + 20, y: bottom(to) + 2 };
  const startX = Math.min(Math.max(tip.x - 16, from.x + 16), right(from) - 16);
  return arc({ x: startX, y: from.y - 2 }, { x: startX, y: (from.y + tip.y) / 2 }, tip);
}
