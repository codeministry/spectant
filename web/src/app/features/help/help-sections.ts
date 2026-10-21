import type { SpecType, WorkflowStage } from '../../../../../core/src/files';
import { CLAIMLESS_RULE, STAGE_RULES, TYPE_NEEDS, WORKFLOW_TYPES } from '../../../../../core/src/stage';
import {
  GROUP_CONTEXT,
  type Shortcut,
  SHORTCUT_CONTEXTS,
  SHORTCUT_GROUPS,
  type ShortcutContext,
  type ShortcutGroup,
  SHORTCUTS,
} from '../../layout/shell/keyboard-bindings';

/**
 * The Help page's sections and the data they render (spec 008, T162, ISC-133.1). Everything here is read from the
 * sources the rest of the app uses — core's stage table and default workflow, the one shortcut table — so the page
 * states nothing a second list could let drift.
 */

/** One section of the page: its id (the nav chip's fragment), its heading's id and its nav label key. */
export interface HelpSection {
  readonly id: string;
  readonly heading: string;
  readonly label: string;
}

/** The sections in page order; the nav renders one chip per entry. */
export const HELP_SECTIONS: readonly HelpSection[] = [
  { id: 'about', heading: 'help-about', label: 'help.nav.about' },
  { id: 'moves', heading: 'help-moves', label: 'help.nav.moves' },
  { id: 'workflows', heading: 'help-workflows', label: 'help.nav.workflows' },
  { id: 'commands', heading: 'help-commands', label: 'help.nav.commands' },
  { id: 'glossary', heading: 'help-glossary', label: 'help.nav.glossary' },
  { id: 'start', heading: 'help-start', label: 'help.nav.gettingStarted' },
  { id: 'keys', heading: 'help-keys', label: 'help.nav.keyboard' },
];

/** The spec types in core's row order: one type chip each, jumping to that type's figure. */
export const HELP_TYPES: readonly SpecType[] = WORKFLOW_TYPES;

/** One command of the Commands table: the command as core's stage table names it, and its catalogue id. */
export interface HelpCommand {
  readonly command: string;
  readonly key: string;
}

/** One row of the legend above the figures; `edge` is the board card's edge token for the same meaning. */
export interface LegendEntry {
  readonly key: 'moving' | 'waits' | 'done' | 'detour' | 'optional' | 'gate';
  readonly look: 'edge' | 'dashed' | 'dotted' | 'gate';
  readonly edge: string | null;
}

/**
 * moving · waits on you · done · detour · optional · fixed gate. The edges are the board's `CARD_EDGE` tokens for
 * build, review and done, the detour the dashed outline of a detour node, an optional step the dotted one, the gate
 * the `shield-check` glyph; `help-sections.spec.ts` holds them equal to `CARD_EDGE`, which is not imported here so
 * the help chunk does not pull in the board card.
 */
export const LEGEND: readonly LegendEntry[] = [
  { key: 'moving', look: 'edge', edge: 'var(--color-primary)' },
  { key: 'waits', look: 'edge', edge: 'var(--color-secondary)' },
  { key: 'done', look: 'edge', edge: 'var(--color-accent)' },
  { key: 'detour', look: 'dashed', edge: null },
  { key: 'optional', look: 'dotted', edge: null },
  { key: 'gate', look: 'gate', edge: null },
];

/** The Getting started steps, each a catalogue key under `help.start.steps`. */
export const START_STEPS: readonly string[] = ['install', 'register', 'open'];

interface KeyGroup {
  readonly id: ShortcutGroup;
  readonly bindings: readonly Shortcut[];
}

export interface KeyContext {
  readonly id: ShortcutContext;
  readonly groups: readonly KeyGroup[];
  /** A context of one group names it once, in the context heading — as the `?` sheet does. */
  readonly titled: boolean;
}

/** `SHORTCUTS` grouped by context and group exactly as the `?` sheet lists them: the one table, never a copy. */
export const KEY_CONTEXTS: readonly KeyContext[] = SHORTCUT_CONTEXTS.map((context) => {
  const groups = SHORTCUT_GROUPS.filter((group) => GROUP_CONTEXT[group] === context).map((id) => ({
    id,
    bindings: SHORTCUTS.filter((binding) => binding.group === id),
  }));
  return { id: context, groups, titled: groups.length > 1 };
});

/** A node colour of the lifecycle bands (prototype `WFC`): start, files written, your gate, agents at work, done. */
export type LifecycleTone = 'start' | 'files' | 'gate' | 'agents' | 'done';

/**
 * The steps of the lifecycle: the stages of a feature, and the two optional steps that move no stage: the design pass
 * (`/spec plan`, design.md) and the archive (`/spec done NNN archive`) after done.
 */
export type LifecycleStep = WorkflowStage | 'design' | 'archive';

/** One node of the lifecycle bands (prototype help `wf-node`, spec 024 sweep): a step of a feature, in order. */
export interface LifecycleNode {
  readonly stage: LifecycleStep;
  /** The step's name: `stages.<stage>`, or `help.lifecycle.steps.<step>` for a step that is no stage. */
  readonly labelKey: string;
  /**
   * The command the stage table names for this stage (`STAGE_RULES[].next`), the Spec skill's own command for a step
   * that is no stage, or null where there is none.
   */
  readonly command: string | null;
  /** The file that command writes, relative to the spec folder; the done node names the field it sets. */
  readonly file: string;
  readonly tone: LifecycleTone;
  /** Whether the node carries a gate pill (`help.lifecycle.gates.<stage>`). */
  readonly gate: boolean;
  /** An optional step: drawn dotted, with the pill `help.lifecycle.optional.<stage>` saying when it applies. */
  readonly optional: boolean;
}

/** One band of the lifecycle: its catalogue key under `help.lifecycle.bands` and its five nodes. */
export interface LifecycleBand {
  readonly key: 'shape' | 'build';
  readonly offset: number;
  readonly nodes: readonly LifecycleNode[];
}

const commandOf = (stage: WorkflowStage): string | null =>
  STAGE_RULES.find((rule) => rule.stage === stage && rule.next !== null && rule !== CLAIMLESS_RULE)?.next ?? null;

const node = (stage: WorkflowStage, file: string, tone: LifecycleTone, gate = false, optional = false): LifecycleNode => ({
  stage,
  labelKey: `stages.${stage}`,
  command: commandOf(stage),
  file,
  tone,
  gate,
  optional,
});

/** The plugin's commands for the two steps that are no stage: the design pass runs in `plan`, the archive in `done`. */
const DESIGN_COMMAND = '/spec plan';
const ARCHIVE_COMMAND = '/spec done NNN archive';

/** A step that is no stage: always optional, with the Spec plugin's command for it. */
const step = (stage: 'design' | 'archive', command: string, file: string, tone: LifecycleTone): LifecycleNode => ({
  stage,
  labelKey: `help.lifecycle.steps.${stage}`,
  command,
  file,
  tone,
  gate: false,
  optional: true,
});

/**
 * The lifecycle in two bands (prototype help "How a spec moves": "Shape & plan", "Build & finish"): a feature's
 * stages with the command core's stage table names for each, and the files those commands write. Every option shows:
 * the design pass for a UI spec before the plan, the code review as optional (per spec, once per feature or voluntary,
 * as the workspace's `specs/workflow.md` says; spec 028) and the archive after done.
 */
export const LIFECYCLE: readonly LifecycleBand[] = [
  {
    key: 'shape',
    offset: 0,
    nodes: [
      node('idea', 'spec.md, context.md', 'start'),
      step('design', DESIGN_COMMAND, 'design.md', 'files'),
      node('plan', 'plan.md', 'files'),
      node('tasks', 'tasks.md', 'files'),
      node('review', '.gates/reviewed.json', 'gate', true),
    ],
  },
  {
    key: 'build',
    offset: 5,
    nodes: [
      node('build', 'tasks.md, events.jsonl', 'agents', true),
      node('code-review', '.gates/code-reviewed.json', 'gate', false, true),
      node('close', 'spec.md', 'files', true),
      node('done', 'spec.md phase', 'done'),
      step('archive', ARCHIVE_COMMAND, 'specs/archive/<NNN-slug>/', 'done'),
    ],
  },
];

/** The chain under the bands: every step of the lifecycle in order, the optional ones marked. */
export const STAGE_CHAIN: readonly LifecycleNode[] = LIFECYCLE.flatMap((band) => band.nodes);

/** The lifecycle legend (prototype `.wf-legend`), one swatch per tone. */
export const LIFECYCLE_TONES: readonly LifecycleTone[] = ['start', 'files', 'gate', 'agents', 'done'];

/** One row of the prototype type table (help "How a spec moves"): which of spec.md, plan.md and tasks.md a type has. */
export interface HelpTypeFiles {
  readonly type: SpecType;
  readonly plan: boolean;
  readonly tasks: boolean;
  /** The files the type skips, by stage name (`plan`, `tasks`), or empty. */
  readonly skips: readonly string[];
}

/** The type table from core's `TYPE_NEEDS`, in `WORKFLOW_TYPES` order; every type has a spec.md. */
export const HELP_TYPE_FILES: readonly HelpTypeFiles[] = WORKFLOW_TYPES.map((type) => {
  const { plan, tasks } = TYPE_NEEDS[type];
  return { type, plan, tasks, skips: [...(plan ? [] : ['plan']), ...(tasks ? [] : ['tasks'])] };
});

/** A command row of the prototype commands table: what it needs, what it writes and the command after it. */
export interface HelpCommandRow extends HelpCommand {
  readonly needs: string | null;
  readonly writes: string | null;
  readonly then: string | null;
}

const LIFECYCLE_NODES: readonly LifecycleNode[] = STAGE_CHAIN;

/** The command that shapes a story before `/spec new` turns it into a spec: the start of the lifecycle. */
const STORY_COMMAND = '/spec idea';
const STORY_FILE = 'specs/ideas/<slug>.md';

/**
 * The catalogue key of a command (`help.commands.list.<key>`): the command without its slash and its `NNN` placeholder,
 * the words joined by `-` (`/spec done NNN archive` → `spec-done-archive`, bare `/spec` → `spec`).
 */
const keyOf = (command: string): string =>
  command
    .replace(/^\//, '')
    .replace(/\bNNN\b/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .trim()
    .replace(/[^a-z0-9]+/gi, '-');

/**
 * Every command of the lifecycle, each once, in lifecycle order: `/spec idea` first, then each node's command (the
 * stage table's `STAGE_RULES[].next` and the optional steps' own), then the stage-table commands no node names
 * (bare `/spec`, the blocked row's). A command two nodes share (`/spec plan`: the design pass and the plan) is listed once.
 */
export const HELP_COMMANDS: readonly HelpCommand[] = [
  ...new Set([
    STORY_COMMAND,
    ...LIFECYCLE_NODES.flatMap((n) => (n.command === null ? [] : [n.command])),
    ...STAGE_RULES.flatMap((rule) => (rule.next === null ? [] : [rule.next])),
  ]),
].map((command) => ({ command, key: keyOf(command) }));

/**
 * `HELP_COMMANDS` with the lifecycle around each: the file the step before it writes, its own file, and the next
 * command. An optional step is skipped as the neighbour of another, so the required path reads straight through.
 */
export const HELP_COMMAND_ROWS: readonly HelpCommandRow[] = HELP_COMMANDS.map((row) => {
  if (row.command === STORY_COMMAND) return { ...row, needs: null, writes: STORY_FILE, then: LIFECYCLE_NODES[0]?.command ?? null };
  // A command a required node shares with an optional step describes the required node (the plan, not the design pass).
  const required = LIFECYCLE_NODES.findIndex((n) => n.command === row.command && !n.optional);
  const at = required >= 0 ? required : LIFECYCLE_NODES.findIndex((n) => n.command === row.command);
  const here = at < 0 ? undefined : LIFECYCLE_NODES[at];
  const before = LIFECYCLE_NODES.slice(0, Math.max(at, 0)).filter((n) => !n.optional).at(-1);
  return {
    ...row,
    needs: at === 0 ? STORY_FILE : (before?.file ?? null),
    writes: here?.file ?? null,
    then: at < 0 ? null : (LIFECYCLE_NODES.slice(at + 1).find((n) => n.command !== null && !n.optional)?.command ?? null),
  };
});
