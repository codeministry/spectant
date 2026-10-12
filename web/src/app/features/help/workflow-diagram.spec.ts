import type { WorkflowRow } from '../../../../../core/src/files';
import { defaultWorkflowRow } from '../../../../../core/src/stage';
import { diagramDirection, type DiagramLabels, transitionList, workflowDiagram } from './workflow-diagram';

const LABELS: DiagramLabels = {
  stage: (stage) => stage,
  gateReviewed: 'gate · reviewed mark',
  gateClosed: 'gate · every claim closed',
};

/** Harbor's feature row (`core/fixtures/harbor/specs/workflow.md`): review moved before tasks. */
const HARBOR_FEATURE: WorkflowRow = {
  type: 'feature',
  stages: ['plan', 'review', 'tasks', 'build', 'code-review', 'close', 'done'],
  codeReview: 'spec',
};

const lines = (text: string): string[] => text.split('\n').map((line) => line.trim());

describe('workflowDiagram', () => {
  it('draws the default feature row as a stateDiagram-v2, left to right', () => {
    expect(workflowDiagram(defaultWorkflowRow('feature'), 'LR', LABELS)).toBe(
      [
        'stateDiagram-v2',
        '  direction LR',
        '  classDef fixedGate stroke-width:3px',
        '  classDef detour stroke-dasharray:4 4',
        '  state "plan" as s_plan',
        '  state "tasks" as s_tasks',
        '  state "review" as s_review',
        '  state "build" as s_build',
        '  state "code-review" as s_code_review',
        '  state "close" as s_close',
        '  state "done" as s_done',
        '  state "blocked" as s_blocked',
        '  state "close-pending" as s_close_pending',
        '  [*] --> s_plan',
        '  s_plan --> s_tasks',
        '  s_tasks --> s_review',
        '  s_review --> s_build : gate · reviewed mark',
        '  s_build --> s_code_review',
        '  s_code_review --> s_close',
        '  s_close --> s_done : gate · every claim closed',
        '  s_build --> s_blocked',
        '  s_blocked --> s_build',
        '  s_close_pending --> s_code_review',
        '  s_done --> [*]',
        '  class s_review, s_done fixedGate',
        '  class s_blocked, s_close_pending detour',
      ].join('\n'),
    );
  });

  it("follows harbor's deviating feature row: review before tasks, the reviewed-mark gate on tasks → build", () => {
    const text = lines(workflowDiagram(HARBOR_FEATURE, 'LR', LABELS));
    expect(text).toContain('s_plan --> s_review');
    expect(text).toContain('s_review --> s_tasks');
    expect(text).toContain('s_tasks --> s_build : gate · reviewed mark');
    expect(text).not.toContain('s_plan --> s_tasks');
    expect(text).not.toContain('s_review --> s_build : gate · reviewed mark');
  });

  it('marks the two fixed gates once each: the edge into build (never from blocked) and the edge into done', () => {
    const text = lines(workflowDiagram(defaultWorkflowRow('chore'), 'LR', LABELS));
    expect(text.filter((line) => line.endsWith(': gate · reviewed mark'))).toEqual(['s_review --> s_build : gate · reviewed mark']);
    expect(text.filter((line) => line.endsWith(': gate · every claim closed'))).toEqual(['s_build --> s_done : gate · every claim closed']);
    expect(text).toContain('s_blocked --> s_build');
    expect(text).toContain('class s_review, s_done fixedGate');
    // A chore has no code review: no close-pending branch, blocked is its only side node.
    expect(text).toContain('class s_blocked detour');
    expect(text.some((line) => line.includes('close_pending'))).toBe(false);
  });

  it('adds build → close-pending where the row reviews per feature', () => {
    const spike: WorkflowRow = { ...defaultWorkflowRow('spike'), codeReview: 'feature' };
    const text = lines(workflowDiagram(spike, 'LR', LABELS));
    expect(text).toContain('s_build --> s_close_pending');
    expect(text).toContain('s_close_pending --> s_code_review');
  });

  it('labels stages through the caller and keeps mermaid syntax out of labels', () => {
    const text = workflowDiagram(defaultWorkflowRow('chore'), 'TB', {
      stage: (stage) => `Stage: ${stage}; "x"`,
      gateReviewed: 'Gate · Review-Marke',
      gateClosed: 'Gate # jeder Claim',
    });
    expect(text).toContain('state "Stage  review   x " as s_review');
    expect(text).toContain('s_review --> s_build : Gate · Review-Marke');
    expect(text).toContain('s_build --> s_done : Gate   jeder Claim');
  });

  it('turns direction by tier: left to right at wide, top to bottom at medium and compact', () => {
    expect(diagramDirection('wide')).toBe('LR');
    expect(diagramDirection('medium')).toBe('TB');
    expect(diagramDirection('compact')).toBe('TB');
    expect(lines(workflowDiagram(defaultWorkflowRow('bug'), 'TB', LABELS))[1]).toBe('direction TB');
  });
});

describe('transitionList', () => {
  it('lists the moves in the order the diagram draws them, gates flagged', () => {
    expect(transitionList(defaultWorkflowRow('chore'))).toEqual([
      { from: 'review', to: 'build', gate: 'reviewed' },
      { from: 'build', to: 'done', gate: 'closed' },
      { from: 'build', to: 'blocked', gate: null },
      { from: 'blocked', to: 'build', gate: null },
    ]);
  });
});
