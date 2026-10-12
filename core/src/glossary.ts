// The glossary (spec 008, ISC-116): the words the spec format uses, one row per term, as data. FORMAT.md § Glossary
// holds the same rows as a table; `core/tests/glossary.test.ts` compares each row with its table line verbatim, so
// neither side can change alone. The rows are literals: no file system, no Node API, so the module rides the
// browser-safe barrel and the Help page renders them from this export.

/** One glossary row: the Spectant term, the term an issue tracker uses, the German term and a one-sentence definition. */
export interface GlossaryRow {
  /** The Spectant term. */
  readonly term: string;
  /** The term an issue tracker uses for the same thing; a pointer, never a rename. */
  readonly common: string;
  /** The German term. */
  readonly german: string;
  /** One sentence, as FORMAT.md writes it. */
  readonly definition: string;
}

/** The thirteen glossary rows, in FORMAT.md order. */
export const GLOSSARY: readonly GlossaryRow[] = [
  {
    term: 'Feature',
    common: 'Epic',
    german: 'Feature',
    definition: 'A block `### F<n>` of the master that owns claims.',
  },
  {
    term: 'Spec',
    common: 'Story',
    german: 'Spec',
    definition: 'A numbered folder `specs/NNN-slug/` with a `spec.md`.',
  },
  {
    term: 'Claim',
    common: 'Acceptance criterion',
    german: 'Claim',
    definition: 'One falsifiable line `- [ ] ISC-<n>:` that closes on its probe.',
  },
  {
    term: 'Task',
    common: 'Sub-task',
    german: 'Task',
    definition: 'One atomic step of `tasks.md`, hanging on exactly one claim.',
  },
  {
    term: 'Milestone',
    common: 'Fix version',
    german: 'Meilenstein',
    definition: "A release named in the master's `## Milestones` block.",
  },
  {
    term: 'Idea',
    common: 'Backlog item',
    german: 'Idee',
    definition: 'A story file under `specs/ideas/`, the stage before a spec.',
  },
  {
    term: 'Stage',
    common: 'Status',
    german: 'Stage',
    definition: 'Where a spec stands in its workflow.',
  },
  {
    term: 'Workflow',
    common: 'Workflow',
    german: 'Workflow',
    definition: 'The ordered stages a spec type runs through, from `specs/workflow.md` or the default.',
  },
  {
    term: 'Gate',
    common: 'Quality gate',
    german: 'Gate',
    definition:
      'A condition a transition needs; two are fixed in every workflow: review before build, and every claim closed before done.',
  },
  {
    term: 'Probe',
    common: 'Test',
    german: 'Probe',
    definition: 'The command a claim closes on.',
  },
  {
    term: 'Actor',
    common: 'Assignee',
    german: 'Akteur',
    definition: 'The neutral id in a file, `u:<8 hex>` for a person or `a:<kind>:<id>` for an agent.',
  },
  {
    term: 'Agent',
    common: 'Bot',
    german: 'Agent',
    definition: 'A Claude Code session or sub-agent working a task, recorded as an `a:` actor.',
  },
  {
    term: 'Chore',
    common: 'Chore',
    german: 'Chore',
    definition: 'The seventh spec type: `spec.md` only, review then build then done, no code review.',
  },
];
