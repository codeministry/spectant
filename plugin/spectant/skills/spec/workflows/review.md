# `/spec review <NNN> [code]` — review a spec, optionally its code

Two parts. **Part 1** (`/spec review <NNN>`) reads the spec before the build: a short summary in the chat, then the
reviewed mark on the user's explicit yes. No page and no app are needed; Spectant sets the same mark from its review
view. **Part 2** (`/spec review <NNN> code`) is the optional code review after the build: the built-in `/code-review`
and `/security-review` on the spec's working tree, fixes only on the user's yes, then the code-reviewed mark.

`CLI` below stands for `bun "${CLAUDE_PLUGIN_ROOT}/bin/spec-check"` (exit 0 ok · 1 bad arguments · 3 drift or gate
open · 4 lock lost; `--json` for machine output). This workflow never writes `spec.md`, `plan.md`, `tasks.md` or the
master `ISA.md`; the CLI writes the marks and their events.

## Resolve and open the run

1. Resolve the folder under `./specs/`: `NNN` given → `specs/NNN-*`; nothing given → the folder whose `spec.md`,
   `plan.md` or `tasks.md` changed last, else the highest number. No `specs/` or no `spec.md` there → say so and stop.
2. `CLI run start specs/NNN-slug --command "/spec review NNN"` (or `"/spec review NNN code"`). Keep the run ID. Every
   exit from here on, a "not yet", a stop or an error included, ends with `CLI run end <run-id> --outcome ok` (or
   `--outcome error`).

## Part 1 — the spec review

1. **Gather.** `CLI status NNN` (stage, claims closed of total, files), `CLI gate check reviewed specs/NNN-slug` (exit
   0: the mark is fresh; exit 3: missing, or stale with the changed files named) and `CLI frontier specs/NNN-slug` (what
   the first round could take). These write nothing and take no lock.
2. **Summarize in the chat**, short enough to read in a minute: the goal in one sentence; the claims, open ones named;
   the plan's approach; the task count per lane; the first-round preview; and anything that should stop a build: open
   `⟨?: …⟩` marks, fog lines, a file the type requires that is missing (`plan.md` for feature, project and infra,
   `tasks.md` for feature, project and refactor at three claims or more), a claim without a probe, a task without a
   claim. When the mark is stale, say which files changed since.
3. **Ask once**, with one `AskUserQuestion`: "Approve spec NNN for `/spec implement`?", options **Approve**
   (recommended, listed first, when every required file exists and nothing blocks) and **Not yet** (listed first and
   recommended when something blocks, with the reason in its description).
4. **Approve** → `CLI gate reviewed specs/NNN-slug --yes`. It writes `specs/NNN-slug/.gates/reviewed.json`, bound to
   the sha256 of the normalised `spec.md`, `plan.md` and `tasks.md` (frontmatter, checkbox states, `~~` and the
   `## Not yet specified`, `## Decisions` and `## Verification` sections ignored), and appends exactly one line to the
   spec's `events.jsonl`. Without `--yes` it only prints what it would write. **Not yet** → write nothing and say that
   `/spec implement` stays closed until a fresh mark exists.
5. **Reply in one line:** spec, missing files, first-round preview, whether the review is recorded. Then
   `CLI run end <run-id> --outcome ok`.

Only the user's explicit answer in this session approves. Silence, a "looks fine" about the summary, or an approval
from another session is not a yes. Any later edit to the three files makes the mark stale on purpose; what
`/spec implement` writes itself (checkboxes, `## Verification`, `## Decisions`) does not.

## Part 2 — the code review (optional)

A spec closes on its claims and the repository's quick tier; the code and security review is optional per spec. Run
it when the user asks, when the repository's `CLAUDE.md` or `specs/constitution.md` requires it, or when the spec's
stage is `code-review` (every claim closed, the workflow has a code review, the mark not fresh). A repository whose
`specs/workflow.md` sets `code_review: feature` reviews once per feature, when its last spec closes its claims; review
the working tree of that feature in the same way and record the mark for each spec of it.

1. **Scope.** The working tree of the spec: its own git worktree when one exists for the spec's branch, else the
   checkout the spec folder is in. Show `git status --short` and `git diff HEAD --stat` in one short block, and point
   out files that look unrelated to this spec, since unrelated changes belong in separate commits. Nothing changed
   against `HEAD` and no unpushed commits → say so and stop.
2. **Review**, both through the Skill tool, in this order: the built-in `code-review` on the working tree, then the
   built-in `security-review` on the pending changes. Collect the findings of both in one list, most severe first, each
   with file, line and one sentence.
3. **Findings exist** → show the list and stop for the user's decision. Fix only the findings the user names (or
   "all"), then run both reviews again. Findings the user explicitly accepts as they are stay open and are counted in
   the mark. Never fix without that yes.
4. **Clean, or only accepted findings left** → record the state:
   `CLI gate code-reviewed specs/NNN-slug --yes --code <open code findings> --security <open security findings>
   [--note "<accepted: …>"]`. It writes `specs/NNN-slug/.gates/code-reviewed.json`, bound to the git tree id of the
   reviewed working tree, and appends one line to `events.jsonl` when the spec stands in `code-review`. Any later edit
   makes the mark stale.
5. **Offer the commit; do not run it.** The plugin commits or pushes only where the repository's `CLAUDE.md` allows it,
   and then only on the user's explicit yes in this session. Offer: the branch (the current one; on the default branch,
   a new one named by the repository's own branch rule from its `CLAUDE.md` or constitution, else
   `feature/NNN-slug`), a commit message (a subject line under 72 characters naming the change, a blank line, a short
   body naming the spec and the claims it closes, in the language the repository's commits use), and the push target.
6. **On an explicit yes:** `CLI gate check code-reviewed specs/NNN-slug` must exit 0 immediately before; a stale mark
   means something changed after the review, so name the files and go back to step 2. Then stage the reviewed tree
   (`git add -A`, nothing else), commit with the agreed message, and push only if the yes included it. No
   `--no-verify`, no amend of a pushed commit, no force push.
7. **Report in one line:** findings found, fixed and accepted; the mark; the commit and push target if done. Then
   `CLI run end <run-id> --outcome ok`. The next step after a clean state is `/spec done <NNN>`.
