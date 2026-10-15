import type { WorkflowRow, WorkflowStage } from '../../../../../core/src/files';
import { defaultWorkflowRow } from '../../../../../core/src/stage';
import { CARD_EDGE } from '../board/board-card';
import {
  type DiagramLabels,
  FIGURE,
  type FigureStep,
  optionalSteps,
  SHIELD_CHECK,
  STAGE_EDGE,
  transitionList,
  type WorkflowLayout,
  workflowLayout,
} from './workflow-diagram';

const LABELS: DiagramLabels = {
  stage: (stage) => stage.toUpperCase(),
  design: 'DESIGN',
  optional: (name) => `${name}?`,
  gateReviewed: 'gate · reviewed mark',
  gateClosed: 'gate · every claim closed',
};

/** Harbor's feature row (`core/fixtures/harbor/specs/workflow.md`): review moved before tasks. */
const HARBOR_FEATURE: WorkflowRow = {
  type: 'feature',
  stages: ['plan', 'review', 'tasks', 'build', 'code-review', 'close', 'done'],
  codeReview: 'spec',
};

const ALL_STAGES: readonly WorkflowStage[] = ['idea', 'plan', 'tasks', 'review', 'build', 'blocked', 'close-pending', 'code-review', 'close', 'done'];

/** Spectant's own feature row (spec 028): no code-review stage, build goes straight to close. */
const NO_REVIEW: WorkflowRow = { type: 'feature', stages: ['plan', 'tasks', 'review', 'build', 'close', 'done'], codeReview: 'none' };

const node = (layout: WorkflowLayout, stage: FigureStep) => {
  const found = layout.nodes.find((n) => n.stage === stage);
  if (!found) throw new Error(`no node ${stage}`);
  return found;
};
/** The stages on the line, without the optional design pass that leads it. */
const mainLine = (layout: WorkflowLayout) => layout.nodes.filter((n) => !n.detour && !n.optional);
const pairs = (layout: WorkflowLayout) => layout.edges.map((e) => `${e.from}→${e.to}:${e.kind}`);

describe('workflowLayout', () => {
  it('lays the default feature row out left to right, one 32 px node per stage in table order, after the design pass', () => {
    const layout = workflowLayout(defaultWorkflowRow('feature'), LABELS);
    const main = mainLine(layout);
    expect(main.map((n) => n.stage)).toEqual(['plan', 'tasks', 'review', 'build', 'code-review', 'close', 'done']);
    expect(main.map((n) => n.label)).toEqual(['PLAN', 'TASKS', 'REVIEW', 'BUILD', 'CODE-REVIEW', 'CLOSE', 'DONE']);
    for (const n of layout.nodes) expect(n.height).toBe(32);
    // One horizontal line: the same top, each node one slot to the right of the one before.
    expect(new Set(main.map((n) => n.y)).size).toBe(1);
    main.slice(1).forEach((n, i) => expect(n.x - (main[i]?.x ?? 0)).toBe(FIGURE.nodeWidth + FIGURE.gap));
    const design = node(layout, 'design');
    expect([design.x, design.y, design.optional, design.detour, design.label]).toEqual([FIGURE.pad, main[0]?.y, true, false, 'DESIGN?']);
    expect(main[0]?.x).toBe(FIGURE.pad + FIGURE.optionalWidth + FIGURE.gap);
  });

  it('draws the chain, the gates and the blocked loop as edges, from core’s moves', () => {
    const layout = workflowLayout(defaultWorkflowRow('feature'), LABELS);
    expect(pairs(layout)).toEqual([
      'plan→tasks:main',
      'tasks→review:main',
      'review→build:gate',
      'build→code-review:main',
      'code-review→close:main',
      'close→done:gate',
      'build→blocked:loop',
      'blocked→build:loop',
      'design→plan:optional',
    ]);
    // Every move core lists is drawn, but close-pending's way out: under a per-spec review nothing leads into it.
    const drawn = layout.edges.filter((e) => e.kind !== 'optional').map(({ from, to }) => ({ from, to }));
    const moves = transitionList(defaultWorkflowRow('feature')).map(({ from, to }) => ({ from, to }));
    expect(drawn).toEqual(moves.filter((m) => m.from !== 'close-pending'));
  });

  it('puts blocked under build, below the main line, and closes the loop with two arcs', () => {
    const layout = workflowLayout(defaultWorkflowRow('bug'), LABELS);
    const build = node(layout, 'build');
    const blocked = node(layout, 'blocked');
    expect(blocked.detour).toBe(true);
    expect(blocked.y).toBeGreaterThan(build.y + build.height);
    expect(blocked.x + blocked.width / 2).toBe(build.x + build.width / 2);
    const loop = layout.edges.filter((e) => e.kind === 'loop');
    expect(loop).toHaveLength(2);
    // Arcs, not straight lines: each path is a quadratic curve.
    for (const edge of loop) expect(edge.path).toMatch(/^M[\d.]+ [\d.]+ Q[\d.]+ [\d.]+ [\d.]+ [\d.]+$/);
  });

  it('adds the close-pending branch under the main line where the row reviews per feature', () => {
    const spike: WorkflowRow = { ...defaultWorkflowRow('feature'), codeReview: 'feature' };
    const layout = workflowLayout(spike, LABELS);
    expect(pairs(layout)).toContain('build→close-pending:branch');
    expect(pairs(layout)).toContain('close-pending→code-review:branch');
    const pending = node(layout, 'close-pending');
    const blocked = node(layout, 'blocked');
    expect(pending.detour).toBe(true);
    expect(pending.y).toBe(blocked.y);
    // Beside blocked, never on top of it.
    expect(pending.x).toBeGreaterThanOrEqual(blocked.x + blocked.width);
    expect(pending.x + pending.width + FIGURE.pad).toBeLessThanOrEqual(layout.size.width);
  });

  it('draws close-pending only where a move leads into it: under code_review feature, never under spec or none', () => {
    // A per-spec review still lists close-pending → code-review (rowTransitions), but no stage reaches close-pending.
    expect(workflowLayout(defaultWorkflowRow('feature'), LABELS).nodes.some((n) => n.stage === 'close-pending')).toBe(false);
    expect(workflowLayout(NO_REVIEW, LABELS).nodes.some((n) => n.stage === 'close-pending')).toBe(false);
    expect(workflowLayout(defaultWorkflowRow('chore'), LABELS).nodes.some((n) => n.stage === 'close-pending')).toBe(false);
  });

  it('lists the optional steps: the design pass but for spike and infra, a voluntary code review where the row has none', () => {
    expect(optionalSteps(defaultWorkflowRow('feature'))).toEqual([{ step: 'design', from: null, to: 'plan' }]);
    expect(optionalSteps(defaultWorkflowRow('bug'))).toEqual([{ step: 'design', from: null, to: 'review' }]);
    expect(optionalSteps(defaultWorkflowRow('spike'))).toEqual([]);
    expect(optionalSteps(defaultWorkflowRow('infra'))).toEqual([]);
    expect(optionalSteps(NO_REVIEW)).toEqual([
      { step: 'design', from: null, to: 'plan' },
      { step: 'code-review', from: 'build', to: 'close' },
    ]);
    expect(optionalSteps(defaultWorkflowRow('chore'))).toEqual([
      { step: 'design', from: null, to: 'review' },
      { step: 'code-review', from: 'build', to: 'done' },
    ]);
  });

  it('draws a voluntary code review dotted under the line, beside blocked, from build to the stage after it', () => {
    const layout = workflowLayout(NO_REVIEW, LABELS);
    expect(mainLine(layout).map((n) => n.stage)).toEqual(NO_REVIEW.stages);
    const review = node(layout, 'code-review');
    const blocked = node(layout, 'blocked');
    expect([review.optional, review.detour, review.gate, review.label]).toEqual([true, true, null, 'CODE-REVIEW?']);
    expect(review.y).toBe(blocked.y);
    expect(review.x).toBeGreaterThanOrEqual(blocked.x + blocked.width);
    expect(pairs(layout)).toEqual(expect.arrayContaining(['build→code-review:optional', 'code-review→close:optional', 'build→close:main']));
    // The voluntary review moves no stage: the solid chain still runs build → close.
    expect(pairs(layout).filter((p) => p.endsWith(':optional'))).toEqual(['design→plan:optional', 'build→code-review:optional', 'code-review→close:optional']);
  });

  it('marks the two fixed gates: a double-framed node, a shield-check annotation above it, the gate label', () => {
    const layout = workflowLayout(defaultWorkflowRow('feature'), LABELS);
    expect(layout.nodes.filter((n) => n.gate !== null).map((n) => [n.stage, n.gate])).toEqual([
      ['build', 'reviewed'],
      ['done', 'closed'],
    ]);
    expect(layout.gates.map((g) => [g.stage, g.kind, g.label])).toEqual([
      ['build', 'reviewed', 'gate · reviewed mark'],
      ['done', 'closed', 'gate · every claim closed'],
    ]);
    for (const gate of layout.gates) {
      const gated = node(layout, gate.stage);
      expect(gate.iconY + FIGURE.iconSize).toBeLessThanOrEqual(gated.y);
      expect(gate.textY).toBeLessThan(gated.y);
      expect(gate.textX).toBeGreaterThan(gate.iconX);
    }
    expect(SHIELD_CHECK.length).toBeGreaterThan(0);
  });

  it("follows harbor's deviating feature row: review before tasks, the reviewed-mark gate on tasks → build", () => {
    const layout = workflowLayout(HARBOR_FEATURE, LABELS);
    expect(mainLine(layout).map((n) => n.stage)).toEqual(HARBOR_FEATURE.stages);
    expect(pairs(layout)).toContain('tasks→build:gate');
    expect(pairs(layout)).toContain('plan→review:main');
    expect(pairs(layout)).not.toContain('review→build:gate');
  });

  it('colours each node’s left edge by its stage’s role, the tokens the board’s card edges use', () => {
    for (const stage of ALL_STAGES) expect(STAGE_EDGE[stage], stage).toBe(CARD_EDGE[stage]);
    const layout = workflowLayout(defaultWorkflowRow('feature'), LABELS);
    expect(node(layout, 'build').role).toBe('moving');
    expect(node(layout, 'review').role).toBe('waits');
    expect(node(layout, 'done').role).toBe('done');
    expect(node(layout, 'blocked').role).toBe('detour');
    expect(node(layout, 'build').edge).toBe('var(--color-primary)');
  });

  it('sizes the canvas to hold every node and the gate labels, wider for a longer row', () => {
    const feature = workflowLayout(defaultWorkflowRow('feature'), LABELS);
    const chore = workflowLayout(defaultWorkflowRow('chore'), LABELS);
    for (const layout of [feature, chore]) {
      for (const n of layout.nodes) {
        expect(n.x + n.width).toBeLessThanOrEqual(layout.size.width);
        expect(n.y + n.height).toBeLessThanOrEqual(layout.size.height);
      }
    }
    expect(feature.size.width).toBeGreaterThan(chore.size.width);
    expect(feature.size.height).toBe(chore.size.height);
  });

  it('is a pure function of the row and the words: the same input gives the same model', () => {
    expect(workflowLayout(HARBOR_FEATURE, LABELS)).toEqual(workflowLayout(HARBOR_FEATURE, LABELS));
  });
});

describe('transitionList', () => {
  it('lists the moves in drawing order (the chain, then the detours), gates flagged', () => {
    expect(transitionList(defaultWorkflowRow('chore'))).toEqual([
      { from: 'review', to: 'build', gate: 'reviewed' },
      { from: 'build', to: 'done', gate: 'closed' },
      { from: 'build', to: 'blocked', gate: null },
      { from: 'blocked', to: 'build', gate: null },
    ]);
  });
});
