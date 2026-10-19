# init — set a repository up for specs

`/spec init`

Sets a git repository up for spec-driven work. It ends with two files that agree: the master `ISA.md` at the
repository root, filled from `templates/master.md` around the user's own stated goal, and `specs/constitution.md`,
filled from `templates/constitution.md` from what already governs the repository. Then it offers the first spec.

## Done looks like this

- `ISA.md` exists at the repository root, carries the user's framing sentence verbatim in `principal_stated_goal`,
  `progress: 0/0`, no claim, a header-only Test Strategy table and the feature block `F0 · Cross-cutting`.
- `specs/constitution.md` exists, names every source it read as a path someone can open, restates no rule text, and
  declares only gate commands that exist in this repository.
- No placeholder (`{{…}}`) survives in either file.
- `.spectant/` is listed in `.gitignore`.
- `spec-check status` reads the repository without an error, and the user has been offered `/spec new <type>`.
- Nothing else in the repository changed, and nothing was committed.

## The run rule

`spec-check` below is the plugin's CLI, run as `bun "${CLAUDE_PLUGIN_ROOT}/bin/spec-check"` (see `SKILL.md`); exit 0
ok, 1 bad arguments, 3 drift or gate open, 4 lock lost. `init` works on no spec and no idea yet, so its run names the
literal subject `init`:

```bash
spec-check run start init --command "/spec init" --json
```

Keep the returned run ID and close the run on every way out, an open question at the end of a turn included:

```bash
spec-check run end <run-id> --outcome ok      # set up, already set up, or stopped by the user
spec-check run end <run-id> --outcome error   # anything that broke the flow
```

A non-zero exit from `spec-check` is never worked around: end the run with `error` and report the exit code and its
message. Every reply starts with the output header `📐 Spec · init: <core sentence>`.

## 1 — Precondition: a git repository

```bash
git rev-parse --show-toplevel
```

The repository root is where both files go. No git repository: say so and stop. `git init` is the user's move, or
runs only on an explicit yes in this session; specs written outside a repository are lost with the directory.

## 2 — Which entry state

Read the root before asking anything: `CLAUDE.md` (root and nested), `README*`, the build files (`package.json`,
`go.mod`, `Cargo.toml`, `pyproject.toml`, …), the CI configuration, a documentation tree and decision records when
they exist, and whether `ISA.md`, `specs/` and `specs/constitution.md` exist.

| State | The repository looks like | What runs |
|-------|---------------------------|-----------|
| **A · greenfield** | no code, no README, the idea is in the user's head | 3 (from the interview) → 4 → 5 → 6 |
| **B · brownfield, no master** | code and a README, nothing articulates done | 3 (drafted from the repository, then confirmed) → 4 → 5 → 6 |
| **C · a master, no `specs/`** | `ISA.md` exists | 4 → 5 → 6 |
| **D · specs without a constitution** | `specs/` exists, `specs/constitution.md` does not | 4 → 5 → 6; no master is created |
| **E · already set up** | `specs/constitution.md` exists | nothing is written: say so, show `spec-check status`, offer `/spec new <type>`, end the run `ok` |

- In state D the existing specs already hold claims. A master created now would know none of them and turn every one
  into drift, so the repository stays without a master: say so in one line. Moving such claims into a new master is
  migration work, not `init`.
- `init` never overwrites an existing `ISA.md` or `specs/constitution.md`.

## 3 — The master `ISA.md` (states A and B)

Fill `${CLAUDE_PLUGIN_ROOT}/skills/spec/templates/master.md`. The placeholders and their fill rules are in
`templates/README.md` § `master.md`; read that table and follow it.

**The stated goal comes first.** Ask the user for the one sentence that frames the project, unless the arguments or the
conversation already hold it. This is the only question that takes free text, because it must be the user's own
words. It lands in `{{stated_goal}}` byte for byte, a `"` written `\"`; never paraphrase, shorten or translate it.
Every claim's `anchors_to` traces back to it, and a paraphrase breaks that anchor.

Then fill the rest:

- **State B:** draft every field from what the repository says (README, `CLAUDE.md`, build files, docs), and mark
  each guess inline as `⟨?: … — why unsure⟩` in the draft you show (never in the written file).
- **State A:** nothing is there to read, so ask.
- In both, ask only what the repository cannot answer and what would change the master's shape: who has the problem,
  what the finished thing looks like, what is deliberately out, the principles and the immovable constraints, and one
  observable goal sentence. **At most five questions, one per `AskUserQuestion`, never batched**, each with your own
  answer first and marked `(Recommended)`, real alternatives beside it. Zero questions is a valid outcome.
- `{{goal}}` is your sharpened, checkable sentence; it is not the stated goal and never replaces it.
- `{{slug}}` is `YYYYMMDD-<project>` for today; `{{project}}` is the repository's folder or remote name in kebab-case.
- Prose follows the language the repository's `CLAUDE.md` names, English when it names none. Structure stays English:
  headings, frontmatter keys, `F0 · Cross-cutting`, the Test Strategy header.

Show the filled master in one fenced `markdown` block, then one `AskUserQuestion`: **Write it (Recommended)** ·
**Change a field** (ask which and how, show it again, ask again) · **Stop** (nothing is written; end the run `ok`).
On the yes, write `<root>/ISA.md` once. Claims are not written here: they are minted later, with the first spec,
through `spec-check mint`.

## 4 — The constitution `specs/constitution.md`

Fill `${CLAUDE_PLUGIN_ROOT}/skills/spec/templates/constitution.md`; its placeholders and the rules for filling it are
in `templates/README.md` § `constitution.md`. The constitution is **derived, never interviewed from zero**: it says
which sources bind spec work, what each governs, a verdict per settled rule, and the gates, and it points at those
sources instead of restating them. A copied rule is wrong as soon as its source changes.

**Sources**, each only when the repository has it:

| Source | Typically holds |
|--------|-----------------|
| `CLAUDE.md` at the root and every nested one | why the system is built this way, conventions, hard limits |
| the documentation tree | how the system is built |
| decision records, whatever they are called | technology choices and their reasons |
| `ISA.md` § Principles, § Constraints | the project's own principles and its immovable mandates |
| build and CI configuration | the toolchain and the test obligations that actually run |

In a greenfield repository the master's Principles and Constraints are the only source and the file is small; that is
not wrong.

**House standards are optional.** Add a `house` row to `## Binding sources` only when the repository itself names such
a standards tree (a path or a link in its `CLAUDE.md` or docs), and use the verdicts `adapted`, `deferred`, `waived`
and `grandfathered` only then. Nothing is read from a user-level configuration directory. Without house standards,
`{{standards_version}}` is `none`, `{{sources_note}}` says that none were named, and every verdict rests on a
repository source or there is none.

**Verdicts.** `## Non-negotiables` lists exceptions and repository-specific probes, not the rule set: the opening
sentence binds every applicable rule wholesale. Two repository sources that contradict each other are a finding to
ask about, never a coin flip. A rule with no source behind it is reported, not invented.

**The design track** (`app`, `marketing` or `none`) is a repository property, inherited by every spec. Derive it from
evidence (a web front end, a landing site, neither), show the evidence with the verdict and let the user confirm in
one `AskUserQuestion`, the derived track first and `(Recommended)`. Mixed or absent evidence is the same question with
your best reading first. With `app` or `marketing`, add the optional frontmatter key `viewports: [390, 820, 1440]`.

**Gates and the baseline** *(read-only)*:

- Each tier (`static`, `quick`, `full`) names a command that exists in the build files. A tier the repository cannot
  run is written `— (not defined; see Conformance baseline)` and becomes a dated baseline row; a command that does
  not exist is never declared.
- Run the repository's own quick tier **once, unmodified**, when it defines one, and record what is red with the date
  and the command. Never fix anything here: no script added, no threshold changed, no build file touched. A rule no
  gate can speak to is `not measured`, never passing. In a greenfield repository there is nothing to run; say so.
- Lanes stay coarse (about three for a typical web application). `## Adaptations`, `## Conformance baseline` and
  `## Lanes` are dropped when they stay empty.

`{{prose_language}}` is the language the repository's `CLAUDE.md` names for specs, English when it names none. Write
`<root>/specs/constitution.md`, creating `specs/`.

## 5 — Ignore the local state

`.spectant/` holds locks, runs and step lines (written by `spec-check` only) and never belongs in history. Read
`.gitignore`; when no line already covers `.spectant/`, append it, together with the two local folders of a spec when
they are missing:

```gitignore
.spectant/
specs/*/.gates/
specs/*/.evidence/
```

Create `.gitignore` when the repository has none. Never commit the change.

## 6 — Check and offer the first spec

```bash
spec-check status --json
spec-check drift
```

Both exit 0 on a fresh setup: no spec yet, no drift. Then offer the next step in one line and stop:

- **`/spec new feature`** for the first slice. In a fresh repository the master is already the project-level
  artifact, so the first spec is a `feature`, not a `project`; `project` is for a sub-project inside an existing
  repository.
- `/spec idea <sentences>` when the first slice is still rough.

Do not start either unasked, and do not commit: committing follows the repository's own `CLAUDE.md`, and without a
rule there nothing is committed or pushed.

## What this workflow does not do

- It never overwrites `ISA.md` or `specs/constitution.md`, and it never creates a master beside specs that exist.
- It never modifies the repository to improve its own baseline; the only writes are the two files and `.gitignore`.
- It mints no claim and allocates no spec folder.
- It writes no `.html` and reads nothing outside the repository and this plugin.

## Report

The entry state, the stated goal as written, the sources the constitution read, the house rules applied (or none), the
design track, the gates declared and the tiers not defined, the baseline (red, not measured), contradictions that need
the user, and the next step offered.
