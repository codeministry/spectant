// The Help page's workflow figures (spec 008, ISC-123, T161): one layout model per spec type, built from the workflow
// row the planning tree carries and drawn as an inline SVG by `app-workflow-figure`. The moves are core's
// (`rowTransitions`), never re-derived here, so the figure shows exactly what the board would accept; this module only
// places them. Pure: the same row and words give the same model, so the specs assert geometry, not markup.
//
// Left to right at every tier: the stages in table order on one line, the build ⇄ blocked loop and the close-pending
// branch as arcs under it, each fixed gate a double-framed node with a shield-check annotation above it.
import type { WorkflowRow, WorkflowStage } from '../../../../../core/src/files';
import { rowTransitions } from '../../../../../core/src/stage';
import { ICONS } from '../../shared/icons/icons';

/** The words a figure shows, from the catalogue so the active language applies. */
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

/** What a stage does on the board, which picks its left edge: the legend's moving, waits on you, done and detour. */
export type StageRole = 'idea' | 'queued' | 'moving' | 'waits' | 'detour' | 'done';

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

/** The role's edge token: the same the board's cards carry (`CARD_EDGE`, board-card.ts), held equal by the spec. */
export const ROLE_EDGE: Readonly<Record<StageRole, string>> = {
  idea: 'var(--track)',
  queued: 'var(--line)',
  moving: 'var(--color-primary)',
  waits: 'var(--color-secondary)',
  detour: 'var(--held)',
  done: 'var(--color-accent)',
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
  iconSize: 12,
  /** The gate label's font size; its width is estimated from it, for the canvas size only. */
  gateFont: 11,
  arrowLength: 7,
  arrowWidth: 4,
} as const;

export interface FigureNode {
  readonly stage: WorkflowStage;
  readonly label: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** `blocked` or `close-pending`: drawn dashed under the main line. */
  readonly detour: boolean;
  /** The fixed gate a move into this node passes: drawn with a double frame. */
  readonly gate: GateKind | null;
  readonly role: StageRole;
  /** The left edge's colour token. */
  readonly edge: string;
  readonly textX: number;
  readonly textY: number;
}

/** `main` a step of the chain, `gate` a step through a fixed gate, `loop` build ⇄ blocked, `branch` via close-pending. */
export type EdgeKind = 'main' | 'gate' | 'loop' | 'branch';

export interface FigureEdge {
  readonly from: WorkflowStage;
  readonly to: WorkflowStage;
  readonly kind: EdgeKind;
  /** The line up to the arrowhead's base: `M … L …` for a step, `M … Q …` for an arc. */
  readonly path: string;
  /** The arrowhead: a triangle's three points, tip first. */
  readonly head: string;
}

export interface FigureGate {
  readonly kind: GateKind;
  /** The gated node. */
  readonly stage: WorkflowStage;
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

  const mainY = FIGURE.pad + FIGURE.band;
  const detourY = mainY + FIGURE.nodeHeight + FIGURE.drop;
  const makeNode = (stage: WorkflowStage, x: number, y: number, width: number, detour: boolean): FigureNode => {
    const role = roleOf(stage);
    return {
      stage,
      label: labels.stage(stage),
      x,
      y,
      width,
      height: FIGURE.nodeHeight,
      detour,
      gate: detour ? null : (gateInto.get(stage) ?? null),
      role,
      edge: ROLE_EDGE[role],
      // The 3 px edge bar sits at the left, so the label centres in the room right of it.
      textX: x + width / 2 + 4,
      textY: y + FIGURE.nodeHeight / 2,
    };
  };

  const main = row.stages.map((stage, i) => makeNode(stage, FIGURE.pad + i * (FIGURE.nodeWidth + FIGURE.gap), mainY, FIGURE.nodeWidth, false));
  const byStage = new Map<WorkflowStage, FigureNode>(main.map((n) => [n.stage, n]));
  const build = byStage.get('build');
  const used = new Set(moves.flatMap((m) => [m.from, m.to]));
  const detours: FigureNode[] = [];
  if (build && used.has('blocked')) {
    const blocked = makeNode('blocked', centreX(build) - FIGURE.blockedWidth / 2, detourY, FIGURE.blockedWidth, true);
    detours.push(blocked);
    if (used.has('close-pending')) {
      const review = byStage.get('code-review');
      const wanted = (review ? Math.max(centreX(review), centreX(build) + FIGURE.nodeWidth + FIGURE.gap) : centreX(build) + FIGURE.nodeWidth + FIGURE.gap) - FIGURE.pendingWidth / 2;
      detours.push(makeNode('close-pending', Math.max(wanted, right(blocked) + FIGURE.pad), detourY, FIGURE.pendingWidth, true));
    }
  }
  for (const n of detours) byStage.set(n.stage, n);

  const edges: FigureEdge[] = [];
  for (const move of moves) {
    const from = byStage.get(move.from);
    const to = byStage.get(move.to);
    if (!from || !to) continue;
    edges.push({ from: move.from, to: move.to, ...edgeGeometry(from, to), kind: edgeKind(move, from, to) });
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
