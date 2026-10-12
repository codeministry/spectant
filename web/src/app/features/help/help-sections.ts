import type { SpecType, WorkflowStage } from '../../../../../core/src/files';
import { STAGE_RULES, defaultWorkflowRow, WORKFLOW_TYPES } from '../../../../../core/src/stage';
import {
  GROUP_CONTEXT,
  type Shortcut,
  SHORTCUT_CONTEXTS,
  SHORTCUT_GROUPS,
  type ShortcutContext,
  type ShortcutGroup,
  SHORTCUTS,
} from '../../core/keyboard-bindings';

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

/** The chain "How a spec moves" shows: a story's `idea`, then the feature's default row (core's `DEFAULT_WORKFLOW`). */
export const STAGE_CHAIN: readonly WorkflowStage[] = ['idea', ...defaultWorkflowRow('feature').stages];

/** The spec types in core's row order: one type chip each, jumping to that type's figure. */
export const HELP_TYPES: readonly SpecType[] = WORKFLOW_TYPES;

/** One command of the Commands table: the command as core's stage table names it, and its catalogue id. */
export interface HelpCommand {
  readonly command: string;
  readonly key: string;
}

/**
 * The commands of the stage table (`STAGE_RULES[].next`, core's next-command rules), each once, in table order: the
 * story row's command first, then the spec rows'. A row without a command (`done`, `close-pending`) adds none.
 */
export const HELP_COMMANDS: readonly HelpCommand[] = [
  ...new Set(STAGE_RULES.flatMap((rule) => (rule.next === null ? [] : [rule.next]))),
].map((command) => ({ command, key: command.replace(/^\//, '').replace(/[^a-z0-9]+/gi, '-') }));

/** One row of the legend above the figures; `edge` is the board card's edge token for the same meaning. */
export interface LegendEntry {
  readonly key: 'moving' | 'waits' | 'done' | 'detour' | 'gate';
  readonly look: 'edge' | 'dashed' | 'gate';
  readonly edge: string | null;
}

/**
 * moving · waits on you · done · detour · fixed gate. The edges are the board's `CARD_EDGE` tokens for build, review
 * and done, the detour the dashed outline of a detour node, the gate the `shield-check` glyph; `help-sections.spec.ts`
 * holds them equal to `CARD_EDGE`, which is not imported here so the help chunk does not pull in the board card.
 */
export const LEGEND: readonly LegendEntry[] = [
  { key: 'moving', look: 'edge', edge: 'var(--color-primary)' },
  { key: 'waits', look: 'edge', edge: 'var(--color-secondary)' },
  { key: 'done', look: 'edge', edge: 'var(--color-accent)' },
  { key: 'detour', look: 'dashed', edge: null },
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
