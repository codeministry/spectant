// Every workflow opens and closes its run (spec 070, C8, ISC-574): the dashboard's "In progress" block shows each spec
// or idea with a `run-start` line that has no `run-end` yet in `.spectant/activity.jsonl`. A workflow that forgets the
// start never shows up there; one that forgets the end on some way out stays "in progress" forever; one without
// `--session` shows the CLI's own name in place of the session's actor. This test reads every file under
// `skills/spec/workflows/` (new files included, by listing the directory) and pins, in the section that opens the run:
// a `run start <target> --session <actor> --command "/spec <sub> …"` naming the file's own subcommand, before any end or
// stage transition; both `run end <run-id> --outcome ok` and `--outcome error`; a rule that every way out ends the
// run; and the open question that ends a turn named as one of those ways out. `SKILL.md` carries the same rule.
//
// One named exemption: the read-only arms of `status.md` (help, status, drift) work on no single spec and write no
// line at all; its write arm `sync` is held to the same rule as every other workflow.
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const SKILL_DIR = join(import.meta.dir, '..', 'spectant', 'skills', 'spec');
const WORKFLOWS = join(SKILL_DIR, 'workflows');

/** The subcommand a workflow file runs as, where it differs from the file name. */
const SUBCOMMAND: Readonly<Record<string, string>> = { 'status.md': 'sync' };

/** Read-only arms that write no run line, with the reason; each must be stated in its file. */
const EXEMPT: Readonly<Record<string, { readonly arms: RegExp; readonly reason: string }>> = {
  'status.md': {
    arms: /Help, status and drift are read-only and write no run lines/u,
    reason: 'the bare `/spec` (help, status, drift) lists every spec and writes nothing; only `sync` works on one spec',
  },
};

const RUN_START = /(?:spec-check|CLI) run start (\S+) --session <actor> --command "\/spec ([a-z]+)\b/u;
const RUN_END_OK = /(?:spec-check|CLI) run end <run-id> --outcome ok/u;
const RUN_END_ERROR = /--outcome error/u;
const EVERY_EXIT = /every\s+(?:way\s+out|path\s+out|exit)/iu;
const OPEN_QUESTION = /open\s+question/iu;
const TRANSITION = /(?:spec-check|CLI) transition /u;

const files = readdirSync(WORKFLOWS)
  .filter((name) => name.endsWith('.md'))
  .sort();

/** The text from the run start to the next `## ` heading: the section that opens the run and states its end rule. */
function runSection(text: string, start: number): string {
  const next = text.indexOf('\n## ', start);
  return text.slice(start, next === -1 ? text.length : next);
}

describe('every workflow opens and closes its run (ISC-574)', () => {
  test('the workflow directory holds the eleven subcommands, done, implement, doc and tldr included', () => {
    for (const name of ['doc.md', 'done.md', 'idea.md', 'implement.md', 'init.md', 'new.md', 'plan.md', 'review.md', 'status.md', 'tasks.md', 'tldr.md']) {
      expect(files).toContain(name);
    }
    expect(files).toHaveLength(11);
  });

  // Spec 074 (ISC-617): doc and tldr work on the whole repository, not on one spec, so their run names the literal
  // subject as init does; SKILL.md routes each to its own workflow file, and the help lists both commands.
  for (const sub of ['doc', 'tldr']) {
    test(`${sub}.md opens a repo-wide run named ${sub}, SKILL.md routes /spec ${sub} to it and the help lists it`, () => {
      const file = `${sub}.md`;
      expect(files).toContain(file);
      const text = readFileSync(join(WORKFLOWS, file), 'utf8');
      expect(RUN_START.exec(text)?.[1]).toBe(sub);
      const skill = readFileSync(join(SKILL_DIR, 'SKILL.md'), 'utf8');
      expect(skill).toMatch(new RegExp(`^\\| \`${sub}\` \\|[^\\n]*\\| \`workflows/${sub}\\.md\` \\|`, 'mu'));
      const help = readFileSync(join(WORKFLOWS, 'status.md'), 'utf8');
      expect(help).toMatch(new RegExp(`^\\|[^\\n]*\\| \`/spec ${sub}[\` ]`, 'mu'));
    });
  }

  for (const name of files) {
    describe(name, () => {
      const text = readFileSync(join(WORKFLOWS, name), 'utf8');
      const match = RUN_START.exec(text);

      test('opens the run with --session <actor> and --command naming its own subcommand', () => {
        expect(match, `${name} has no "run start <target> --session <actor> --command \\"/spec …\\""`).not.toBeNull();
        expect(match?.[2]).toBe(SUBCOMMAND[name] ?? name.replace(/\.md$/u, ''));
      });

      test('opens the run before any end line or stage transition', () => {
        const start = match?.index ?? Number.POSITIVE_INFINITY;
        const end = text.search(RUN_END_OK);
        const transition = text.search(TRANSITION);
        expect(end).toBeGreaterThan(start);
        if (transition !== -1) expect(transition).toBeGreaterThan(start);
      });

      test('closes the run with run end ok and error, on every way out, an open question included', () => {
        const section = runSection(text, match?.index ?? 0);
        expect(section, `${name}: no "run end <run-id> --outcome ok" where the run opens`).toMatch(RUN_END_OK);
        expect(section, `${name}: no "--outcome error" where the run opens`).toMatch(RUN_END_ERROR);
        expect(section, `${name}: no rule that every way out ends the run`).toMatch(EVERY_EXIT);
        expect(section, `${name}: the open question that ends a turn is not named as a way out`).toMatch(OPEN_QUESTION);
      });

      const exempt = EXEMPT[name];
      if (exempt !== undefined) {
        test(`states its exemption: ${exempt.reason}`, () => {
          expect(text).toMatch(exempt.arms);
        });
      }
    });
  }

  test('SKILL.md states the same rule for every subcommand on a spec or an idea', () => {
    const skill = readFileSync(join(SKILL_DIR, 'SKILL.md'), 'utf8');
    const rule = skill.slice(skill.indexOf('## Runs and stage changes'));
    expect(rule).toMatch(/run start <spec\|idea> --session <actor> --command "\/spec\s+<subcommand> <args>"/u);
    expect(rule).toMatch(/run end <run-id> --outcome ok/u);
    expect(rule).toMatch(RUN_END_ERROR);
    expect(rule).toMatch(OPEN_QUESTION);
  });
});
