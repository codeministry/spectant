# doc — write the repository's tech documentation

`/spec doc [--keep]`

Writes `specs/tech.md`: the technical picture of the whole repository as one document a developer looks things up
in. Its readers are developers, someone re-entering the repository after a break included, not a customer. The
Spectant app shows it beside the live status, the specs and their open questions, so the document holds what the
specs do not: what the system is, how it is built, why, and what can hurt it.

## Done looks like this

- `specs/tech.md` is rewritten from the repository as it stands now and carries the four section keys `overview`,
  `architecture`, `stack` and `risks`.
- Everything a person wrote by hand in the previous version that is still true is carried over.
- `architecture` holds at least one mermaid diagram that mermaid 11 parses, with the prose a newcomer needs to read it.
- The file holds no claim ID, no `- fog:` line and no task list: it reads as documentation, not as a spec.
- `spec-check doc check` exits 0.
- Nothing is committed, no `.html` is written, and nothing else in the repository changed.

## Output header

First line of every reply: `📐 Spec · doc: <core sentence>` (`SKILL.md` § Output header). The document spans the
repository, not one spec, so the header carries no number.

## Arguments

- none: a plain run, which rewrites `specs/tech.md`.
- `--keep`: check only. Nothing is drafted or written; the run reads the existing file, runs the check and reports.

## The run rule

`spec-check` below is the plugin's CLI, run as `bun "${CLAUDE_PLUGIN_ROOT}/bin/spec-check"` (see `SKILL.md`); exit 0
ok, 1 bad arguments, 3 incomplete or gate open, 4 lock lost. `doc` works on no single spec, so its run names the
literal subject `doc`, as `init` does:

```bash
spec-check run start doc --session <actor> --command "/spec doc" --json
```

Keep the returned run ID and close the run on every way out of this workflow, a `--keep` run and an open question
that ends the turn included:

```bash
spec-check run end <run-id> --outcome ok      # tech.md rewritten and checked, or checked with --keep
spec-check run end <run-id> --outcome error   # anything that broke the flow, a check that stays red included
```

A non-zero exit from `spec-check` is never worked around: end the run with `error` and report the exit code and its
message. A repository without `specs/` has nothing to document yet: say so in one line, point at `/spec init`, and end
the run with `ok`.

## 1 — Every run rewrites tech.md

*(safety gate)* The documentation is current after every `/spec doc`, so a plain run always rewrites the file. Where
the draft goes is decided by the CLI, never by hand:

```bash
spec-check doc target [--keep] --json   # {"target": "specs/tech.md", "previous": "specs/tech.prev.md" | null, "keep": …}
```

- `previous` is a path: an existing `specs/tech.md` was just copied, byte for byte, to `specs/tech.prev.md`. Read that
  previous version **before drafting** and carry over what a person wrote by hand that is still true: a sentence of
  judgement, a reason, a warning, a hand-drawn diagram. A rewrite updates the documentation; it does not throw away
  someone's judgement. Drop only what the repository now contradicts, and name each such drop in the report.
- `previous` is `null`: there was no `tech.md`; the draft starts from the repository alone.
- `keep` is true (`--keep` was given): nothing was written; skip to step 4 and only check.

## 2 — Read what the repository already says

What the repository answers is read, not asked.

- The master `ISA.md`, when it exists: the problem, the vision, the constraints, the feature blocks and their
  `Why:` lines, the decisions.
- `specs/constitution.md`: the binding rules, the stack it names, the lanes.
- Every open `specs/NNN-*/spec.md` and its `plan.md`: the approach, the stack decisions, the interfaces, the risks.
- The code where a plan names it, as far as needed to describe the components truthfully. A component the
  documentation names that does not exist is the most common way this document goes wrong.
- The previous version, `specs/tech.prev.md`, from step 1.

## 3 — Draft the four sections

Write `specs/tech.md` to the target path. Each section starts with its marker; a section runs from its marker to the
next one, and text before the first marker belongs to no section.

```markdown
---
title: <the system's name> — tech documentation
lang: <the prose language as a language tag, such as en or de>
---

<!-- section: overview -->
## Overview

<!-- section: architecture -->
## Architecture

<!-- section: stack -->
## Stack

<!-- section: risks -->
## Risks
```

- **overview:** what the system is, who uses it, the problem it answers and why it exists, in a few paragraphs. A
  summary across the specs, not a list of them: the app lists the specs itself.
- **architecture:** the components and how they talk, as at least one mermaid diagram, with the prose a newcomer
  needs to read it. Where a plan already has the right diagram, bring it up to the repository level rather than
  copying it.
- **stack:** every stack choice with its reason, from the constitution and the plans' stack decisions. A choice
  without a reason is a gap to name, not to invent.
- **risks:** what can hurt the system as a whole, from the plans' risk tables; one line each, its mitigation named.

### Mermaid that parses

The app renders the diagram with mermaid 11, which breaks on labels that look harmless:

- Put every node and edge label in double quotes: `api["HTTP API"] -->|"reads"| db["SQLite"]`.
- No `@` and no trailing `/` in an unquoted label; quoting the label fixes both.
- No `.` in the text of a dotted edge (`-.->`); quote it or reword it.
- Read the diagram once more before the check: every bracket closed, every quote paired, one statement per line.

### What tech.md never holds

*(safety gate)* **No claim ID** (`ISC-…`), **no `- fog:` line** and **no task list** (no `- [ ]` or `- [x]` lines, no
task IDs). Status, specs, claims and open questions are shown live in the app; a copy in `tech.md` would be stale
the day after. Describe what the system is, not where its specs stand.

### Language

The prose language comes from the target repository: its `specs/constitution.md` first, then its `CLAUDE.md`; English
when neither names one. Never read it from a personal configuration path outside the repository. Structure stays
English: the section keys, the frontmatter keys and the code.

## 4 — Check

```bash
spec-check doc check --json
```

- Exit 0: all four section keys are there.
- Exit 3, error code `incomplete`: the detail names each missing key, or the missing file. After a rewrite, add the
  missing section and run the check again. On a `--keep` run the file is the user's own: report each missing marker and
  leave the fix to them or to a plain `/spec doc`, never invent it silently.

A check that stays red after one fix ends the run with `error`.

## What this workflow does not do

- **No claim ID, no `- fog:` line, no task list** in `tech.md`.
- **No edit of a spec, a plan, the master or the constitution.** It reads them; it writes only through
  `spec-check doc target` and to `specs/tech.md`.
- **No `.html`**, no rendered page, no image.
- **No commit.** Committing follows the target repository's `CLAUDE.md`; without a rule there, nothing is committed or
  pushed.

Files this workflow touches: `specs/tech.md`, `specs/tech.prev.md` (through `spec-check doc target`) and, through
`spec-check`, the run lines in `.spectant/activity.jsonl`.

## Report

Say whether `tech.md` was rewritten or kept with `--keep`; what changed in substance (new components, a changed
choice, a new or retired risk); what was carried over from the hand-written parts and what was dropped as no longer
true; that `specs/tech.prev.md` holds the previous version; and the check result. Name the Spectant app as the place
to read it beside the live status.
