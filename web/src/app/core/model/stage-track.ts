/** The five segments of the stage track, in order; the labels are `stages.<name>`. */
export const TRACK_STAGES = ['plan', 'tasks', 'review', 'build', 'close'] as const;

/**
 * The track segment a derived stage sits on: `blocked` stays on Build, `code-review` is the last step before Close,
 * `done` is past the last segment (every segment done). An unknown name starts at Plan.
 */
export function stageIndex(stage: string): number {
  switch (stage) {
    case 'blocked':
      return 3;
    case 'code-review':
      return 4;
    case 'done':
      return TRACK_STAGES.length;
    default:
      return Math.max(0, (TRACK_STAGES as readonly string[]).indexOf(stage));
  }
}
