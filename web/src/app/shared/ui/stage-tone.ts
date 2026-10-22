import type { Tone } from './tone';

/** The stages of a spec as the dashboard model's row `stage` names them (`Stage` in `core/src/stage.ts`). */
export type ToneStage = 'plan' | 'tasks' | 'review' | 'build' | 'blocked' | 'code-review' | 'close-pending' | 'close' | 'done';

/**
 * The stages in workflow order, as core counts them (`STAGES` in `core/src/dashboard.ts`): the order of every legend,
 * split meter and filter row that lists stages (spec 064, design.md § Stage statt Phase).
 */
export const STAGE_ORDER: readonly ToneStage[] = ['plan', 'tasks', 'review', 'build', 'blocked', 'code-review', 'close-pending', 'close', 'done'];

/**
 * The tone of each stage on the status chip, the header spec select, the palette and the KPI split, defined once
 * (spec 064, ISC-500). design.md names the theme slots; each maps onto the shared tone that carries it: `--ques` is
 * `secondary`, `--conc` `concern`, `--disp` `primary`, `--hover` `warning`, `--done` `success`. `blocked`, which
 * design.md leaves out, takes `error` (`--fail`), the tone of a stop.
 */
export const STAGE_TONE: Readonly<Record<ToneStage, Tone>> = {
  plan: 'secondary',
  tasks: 'secondary',
  review: 'concern',
  build: 'primary',
  blocked: 'error',
  'code-review': 'warning',
  'close-pending': 'concern',
  close: 'warning',
  done: 'success',
};

/** Whether a word is one of the spec stages (never `idea`, which keeps its own state). */
export const isToneStage = (stage: string): stage is ToneStage => Object.hasOwn(STAGE_TONE, stage);

/** The tone of a stage as the model names it, `neutral` for any other word. */
export const toneOfStage = (stage: string): Tone => (isToneStage(stage) ? STAGE_TONE[stage] : 'neutral');
