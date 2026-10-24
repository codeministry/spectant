# tldr — write the TL;DR over the open specs

`/spec tldr`

Writes `specs/tldr.md`: one short TL;DR of what the repository's open specs are building. It describes the state of
the product itself, not of the specs: what exists, where to open it, what runs where, what can be tried right now and
what is still missing. The Spectant app shows it on the dashboard. Unlike `specs/tech.md`, the TL;DR is a snapshot:
every run overwrites it.

## Done looks like this

- `specs/tldr.md` carries `generated:` (the ISO 8601 time at the end of this run) and `lang:` in its frontmatter, and
  the five section keys `overview`, `try`, `per-spec`, `risks` and `next`.
- Every open spec is named by its number in `per-spec`.
- Every prototype and artifact the facts list is reachable from `try` as a relative link, so someone who reads only
  the TL;DR can open each of them without searching and knows what each shows.
- `spec-check tldr check` exits 0.
- Nothing is committed, no `.html` is written, and nothing else in the repository changed.

## Output header

First line of every reply: `📐 Spec · tldr: <core sentence>` (`SKILL.md` § Output header). The TL;DR spans the
repository, so the header carries no number.

## The run rule

`spec-check` below is the plugin's CLI, run as `bun "${CLAUDE_PLUGIN_ROOT}/bin/spec-check"` (see `SKILL.md`); exit 0
ok, 1 bad arguments, 3 incomplete or gate open, 4 lock lost. `tldr` works on no single spec, so its run names the
literal subject `tldr`, as `init` does:

```bash
spec-check run start tldr --session <actor> --command "/spec tldr" --json
```

Keep the returned run ID and close the run on every way out of this workflow, an open question that ends the turn
included:

```bash
spec-check run end <run-id> --outcome ok      # tldr.md written and checked, or nothing open to summarise
spec-check run end <run-id> --outcome error   # anything that broke the flow, a check that stays red included
```

A non-zero exit from `spec-check` is never worked around: end the run with `error` and report the exit code and its
message. A repository without `specs/` has nothing to summarise: say so in one line, point at `/spec init`, and end the
run with `ok`.

## 1 — Facts first

```bash
spec-check tldr facts --json   # {"specs": [{number, title, stage, progress, openClaims, fog, prototypes, artifacts}]}
```

The facts cover every open spec: its stage, its progress, its open claims, its `- fog:` lines, its prototypes under
`.design/` and its files under `artifacts/`. Draft from them. Open a spec's `spec.md` or `plan.md`, a prototype or an
artifact only as far as needed to say what it shows and whether it works: the facts exist so the run does not read
every file of every spec.

**Ports and addresses** come only from the plans and `specs/constitution.md`, never from probing a port, a process
list or a running service (a recorded decision: the plugin calls no host, and a scan cannot be checked
deterministically). A service the product needs in order to be seen is named with its address from the plan and the
command that starts it, from the plan or the repository's README.

No open spec: write nothing, say so in one line, and end the run with `ok`.

## 2 — Where it goes

```bash
spec-check tldr target --json   # {"target": "specs/tldr.md"}
```

Write the draft to that path, replacing whatever was there.

## 3 — The file

```markdown
---
generated: <ISO 8601, written at the end of the run>
lang: <the prose language as a language tag, such as en or de>
---

<!-- section: overview -->
## Overview
<at most 5 lines: what works, what is only designed, what is missing>

<!-- section: try -->
## Try it
- [Design prototype 004](004-slug/.design/prototype/): what it shows
- The shop runs at http://localhost:4321 (from plan 006; start it with `bun run dev`)

<!-- section: per-spec -->
## Per spec
- **NNN · <short title>**: one line, at most two sentences: what it builds, where it stands, its blocker or next step

<!-- section: risks -->
## Risks and blockers
<at most 5 bullets, one line each>

<!-- section: next -->
## Next
- <at most 5 steps, one line each, each with its command, such as `/spec implement 006`>
```

- **Every open spec by its number** in `per-spec`, one bullet each; the check fails on an open spec it does not find.
- **Links are relative to `specs/`**, where `tldr.md` lives: a prototype as `NNN-slug/.design/…`, an artifact as
  `NNN-slug/artifacts/…`. Never an absolute path.
- **`next` names plugin commands** as `/spec <subcommand> NNN` (`/spec plan 006`, `/spec review 006`,
  `/spec implement 006`, `/spec done 006`), taken from each spec's stage.
- **Short is the point.** The whole body stays under about 50 lines and fits the dashboard card: no sub-headings per
  spec, no lists of open claims, no quoted fog, no repetition between sections. The app shows claims, fog, stages and
  the specs themselves; the TL;DR only says what the product is and what comes next. A claim count or a stage appears
  only where it explains the product's state.
- **Language:** the prose language of the target repository, from its `specs/constitution.md` first, then its
  `CLAUDE.md`; English when neither names one. Never read it from a personal configuration path outside the
  repository. `lang:` carries it as a language tag. Section keys and frontmatter keys stay English.
- **`generated:` last.** The app counts the TL;DR as stale as soon as a spec changed after `generated:`, so write the
  time at the end of the run, after the body is final, never at its start.

## 4 — Check

```bash
spec-check tldr check --json
```

- Exit 0: `generated:` is valid, all five section keys are there, and every open spec is named.
- Exit 3, error code `incomplete`: the detail names each missing key, a missing or invalid `generated:` and each
  unnamed open spec. Fix exactly those, set `generated:` again to the current time, and run the check again.

A check that stays red after one fix ends the run with `error`.

## What this workflow does not do

- **No probing** of ports, processes or running services; addresses come from the plans and the constitution.
- **No edit of a spec, a plan, the master or the constitution.** It reads them; it writes only `specs/tldr.md`.
- **No `.html`**, no rendered page, no image.
- **No commit.** Committing follows the target repository's `CLAUDE.md`; without a rule there, nothing is committed or
  pushed.

Files this workflow touches: `specs/tldr.md` and, through `spec-check`, the run lines in `.spectant/activity.jsonl`.

## Report

Say that `specs/tldr.md` was written and when (`generated:`), how many open specs it covers, what can be tried right
now with its link or address, the most pressing blocker, and the check result. Name the Spectant app as the place to
read it on the dashboard.
