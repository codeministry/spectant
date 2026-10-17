/**
 * generate.ts — writes the synthetic `beacon` fixture tree next to this file (spec 040, T6).
 *
 *   bun core/fixtures/beacon/generate.ts
 *
 * Deterministic: no clock, no randomness, no environment. Every date is fixed in March 2026; the reviewed marks hash
 * the generated text through core/src/gates.ts, the stale and code-reviewed marks hash fixed seed strings. Running it
 * twice produces byte-identical files.
 *
 * Beacon is an invented product (an uptime checker with a public status page). Nothing here is copied from a real
 * repository. The tree is the item-state fixture of spec 040 (ISC-221): every row of the stage table (FORMAT.md § The
 * stage table, `STAGE_RULES` in core/src/stage.ts) holds at least one item, and `.spectant/activity.jsonl` carries the
 * run lifecycle lines (`run-start`, `run-end`) beside claim locks and task run events. The live golden reads the log at
 * the fixed clock 2026-03-08T15:00:00Z (`LIVE_NOW` in core/tests/golden.test.ts); "minutes before the clock" below
 * counts from it. `specs/workflow.md` gives `spike` `code_review: feature` and `bug` `code_review: none`; every other
 * type runs its default row.
 *
 * Stage table row → item:
 *   row 1  idea           specs/ideas/uptime-badges.md (an open run on it), specs/ideas/digest-emails.md
 *   row 2  done           001-check-scheduler   feature, `phase: complete`, events.jsonl from creation to done
 *   row 3  plan           002-status-page       feature without plan.md, no reviewed mark
 *   row 4  tasks          003-alert-rules       feature with plan.md, three claims, no tasks.md
 *   row 5  review         004-incident-notes    feature with plan.md and tasks.md, reviewed mark stale
 *   row 6  build          005-probe-agents      feature, reviewed mark fresh, takeable claims (the live spec, below)
 *                         008-export-formats    spike, one of two claims open: the open sibling of 007 under F6
 *   row 7  done (chore)   010-renew-api-key     chore, every claim closed, reviewed mark fresh, `phase: building`
 *   row 8  close-pending  007-history-export    spike, every claim closed; F6 waits on 008
 *   row 9  code-review    006-retry-backoff     refactor, every claim closed, code-reviewed mark (stale: no tree id)
 *   row 10 close          009-timezone-labels   bug, every claim closed, `code_review: none`
 *   row 11 blocked        011-maintenance-windows  bug, reviewed mark fresh, both open claims wait on spec 002
 *                         (`(after: 002)`): "waits on 002"
 *
 * Marks: reviewed fresh on 001, 005, 006, 007, 008, 009, 010, 011; stale on 004; missing on 002 and 003. The one
 * code-reviewed mark is on 006 (stale, its tree id matches no working tree).
 *
 * Claims and tasks of 005-probe-agents:
 *   ISC-13, ISC-14  closed; T1, T2 ticked
 *   ISC-15          open, held by a recent claim lock (T3), task run events leave T3 `building`
 *   ISC-16          open, held by a stale claim lock (T4, 80 minutes, over the 45-minute `LIVE_STALE_MS`), T4 `dispatched`
 *   ISC-17          open, `(after: ISC-18)`: an open claim edge; T7 `(after: T5)`
 *   ISC-18          open and takeable; T5 `patched`, T6 `applied-open` (applied, box still open)
 *   ISC-19          dropped tombstone `[DROPPED — see Decisions 2026-03-07]`; its task T8 is struck
 *   T1              `applied` (run events up to `apply`, box ticked)
 *
 * `.spectant/activity.jsonl` (in time order), against the clock 15:00:
 *   11:40 run-start  `/spec-code-review 006` on 006, no end: open 200 minutes, older than 120 — aborted
 *   12:30 run-start  `/spec-plan 002` on 002, 12:41 run-end `outcome: error`
 *   13:00 run-start  `/spec-plan 003` on 003, 13:25 run-end `outcome: ok`
 *   13:40 claim      ISC-16 / T4, no release: the stale claim lock; 13:41 dispatch T4
 *   14:00 run-start  `/spec-review 004` on 004, 14:30 run-end `outcome: released` by a person (`u:` session)
 *   14:05–14:14      dispatch, build, patch, apply of T1 (ticked: applied)
 *   14:20 run-start  `/spec-implement 005` on 005, no end (first of two open runs on 005)
 *   14:22–14:31      dispatch, build, patch of T5 (patched)
 *   14:24–14:35      dispatch, build, patch, apply of T6 (box open: applied-open)
 *   14:30 claim      ISC-15 / T3, no release: the held claim lock (30 minutes); 14:31–14:32 dispatch, build of T3
 *   14:40 run-start  `/spec-implement 005` on 005, no end (second open run on 005, the newest)
 *   14:45 run-start  `/spec new uptime-badges` on the idea `uptime-badges`, no end
 *   14:52 run-start  `/spec-tasks 003` on 003, no end: open 8 minutes
 */

import {createHash} from "node:crypto";
import {mkdirSync, rmSync, writeFileSync} from "node:fs";
import {dirname, join} from "node:path";

import {hashForGate, REVIEWED_FILES} from "../../src/gates.ts";

const ROOT = import.meta.dir;
const PERSON = "u:5d0e8b21";
const RELEASER = "u:9a41c6f3";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const sha1 = (s: string) => createHash("sha1").update(s).digest("hex");

function write(rel: string, content: string): void {
    const path = join(ROOT, rel);
    mkdirSync(dirname(path), {recursive: true});
    writeFileSync(path, content);
}

// ── the claim register ─────────────────────────────────────────────────────────────────────────────────

interface Claim { id: string; text: string; closed: boolean; after?: string; dropped?: string; tool: string }
interface Feature { key: string; name: string; why: string; claims: Claim[] }

let next = 1;
const c = (text: string, closed: boolean, tool: string, extra: Partial<Claim> = {}): Claim => ({id: `ISC-${next++}`, text, closed, tool, ...extra});

const C001 = [
    c("A check runs at the interval its definition names, within one second.", true, "bun test tests/scheduler.test.ts -t interval"),
    c("A check that times out is recorded as down, never as up.", true, "bun test tests/scheduler.test.ts -t timeout"),
    c("Two checks on one host never run at the same instant.", true, "bun test tests/scheduler.test.ts -t spread"),
];
const C002 = [
    c("The status page lists every public check with its current state.", false, "bun run e2e -- status -g list"),
    c("The status page renders without script at 390 px.", false, "bun run test:browser -- status"),
    c("Anti: a private check appears on the public status page.", false, "bun test tests/status.test.ts -t private"),
];
const C003 = [
    c("An alert rule names a check, a threshold and a channel.", false, "bun test tests/rules.test.ts -t shape"),
    c("A rule fires once per outage, not once per failed run.", false, "bun test tests/rules.test.ts -t once"),
    c("A rule that names an unknown channel is refused when saved.", false, "bun test tests/rules.test.ts -t channel"),
];
const C004 = [
    c("An incident note is attached to the outage it describes.", false, "bun test tests/notes.test.ts -t attach"),
    c("Incident notes show on the status page, newest first.", false, "bun run e2e -- notes -g order"),
    c("Editing a note keeps its first publication time.", false, "bun test tests/notes.test.ts -t edit"),
];
const C005 = [
    c("A probe agent registers with a one-time token.", true, "bun test tests/agents.test.ts -t register"),
    c("A registered agent reports its results over one connection.", true, "bun test tests/agents.test.ts -t report"),
    c("An agent that stops reporting is shown as silent within two intervals.", false, "bun test tests/agents.test.ts -t silent"),
    c("A check can be pinned to one region's agents.", false, "bun test tests/agents.test.ts -t region"),
];
// The edge claim sits before its target in spec.md: ISC-17 waits on ISC-18.
const C005_EDGE = c("Results from a revoked agent are dropped.", false, "bun test tests/agents.test.ts -t revoked", {after: "ISC-18"});
const C005_EDGE_TARGET = c("An agent's results are signed and rejected when the signature fails.", false, "bun test tests/agents.test.ts -t signed");
C005.push(C005_EDGE, C005_EDGE_TARGET);
const C005_DROPPED = c("Agents update themselves from the console.", false, "bun test tests/agents.test.ts -t update", {dropped: "2026-03-07"});
C005.push(C005_DROPPED);
const C006 = [
    c("A failed run is retried with exponential backoff up to three times.", true, "bun test tests/retry.test.ts -t backoff"),
    c("Anti: a retry is counted as a separate outage.", true, "bun test tests/retry.test.ts -t outage"),
];
const C007 = [
    c("A recorded table names the export formats teams ask for, with one example file each.", true, "bun run cli -- survey exports"),
    c("A decision names the default export format.", true, "bun run cli -- survey exports --decision"),
];
const C008 = [
    c("A recorded table names the largest history each format exports within ten seconds.", true, "bun run cli -- probe exports"),
    c("Anti: an export exceeds the limit the spike recorded for its format.", false, "bun test tests/export.test.ts -t limit", {after: "ISC-24"}),
];
const C009 = [
    c("Times on the status page carry the viewer's time-zone label.", true, "bun run e2e -- status -g timezone"),
];
const C010 = [
    c("The mail relay API key is replaced without a restart.", true, "bun run cli -- keys rotate --dry-run"),
    c("The old mail relay API key is revoked after the swap.", true, "bun run cli -- keys check"),
];
const C011 = [
    c("A maintenance window hides its checks' outages from the status page.", false, "bun run e2e -- status -g maintenance", {after: "002"}),
    c("A maintenance window is announced on the status page a day ahead.", false, "bun run e2e -- status -g announce", {after: "002"}),
];

const FEATURES: Feature[] = [
    {key: "F1", name: "Check scheduling", why: "checks run on time and an outage is never recorded twice.", claims: [...C001, ...C006]},
    {key: "F2", name: "Status page", why: "the people who depend on a service see its state without asking.", claims: [...C002, ...C009]},
    {key: "F3", name: "Alerting", why: "the on-call person hears about an outage once, on the right channel.", claims: [...C003, ...C011]},
    {key: "F4", name: "Incident notes", why: "an outage on the status page says what happened, in words.", claims: C004},
    {key: "F5", name: "Probe agents", why: "checks run from where the users are, not only from one host.", claims: C005},
    {key: "F6", name: "History export", why: "a team takes its uptime history elsewhere without a support ticket.", claims: [...C007, ...C008]},
    {key: "F7", name: "Maintenance", why: "the service's own credentials and dependencies stay current.", claims: C010},
];
const ALL = FEATURES.flatMap((f) => f.claims).sort((a, b) => Number(a.id.slice(4)) - Number(b.id.slice(4)));
// A dropped claim counts neither as closed nor toward the total (FORMAT.md, the progress recount).
const progress = (cs: Claim[]) => `${cs.filter((x) => x.closed).length}/${cs.filter((x) => !x.dropped).length}`;

function claimLine(x: Claim): string {
    const text = x.dropped ? `[DROPPED — see Decisions ${x.dropped}] ${x.text}` : x.text;
    return `- [${x.closed ? "x" : " "}] ${x.id}: ${text}${x.after ? ` (after: ${x.after})` : ""}`;
}

const STRATEGY_HEAD = "| isc | type | check | threshold | tool | anchors_to | severity |\n|-----|------|-------|-----------|------|------------|----------|";
const strategyRow = (x: Claim) => `| ${x.id} | ${x.tool.startsWith("bun test") ? "bun-test" : x.tool.startsWith("bun run e2e") ? "e2e" : x.tool.startsWith("bun run test:browser") ? "browser" : "bash"} | ${x.text.replace(/\.$/, "").toLowerCase()} | pass | \`${x.tool}\` | literal |  |`;

// ── master ─────────────────────────────────────────────────────────────────────────────────────────────

function master(): string {
    return `---
task: "Watch services and publish their state with Beacon"
slug: 20260301-beacon
project: beacon
phase: climbing
progress: ${progress(ALL)}
started: 2026-03-01T08:00:00Z
updated: 2026-03-08T12:00:00Z
---

# Beacon

## Problem

A small team runs a handful of web services. When one goes down, users notice first and ask in chat, and nobody can
say afterwards how long it was down or why.

## Vision

Every service is checked from where its users are, an outage reaches the on-call person once, and a public page tells
everyone else what is going on.

## Out of Scope

- Application performance tracing.

## Principles

- An outage is recorded once and never hidden.

## Constraints

- Bun and TypeScript; the status page works without script.

## Goal

Checks run on schedule from several regions, alerts fire once per outage, and the status page shows the truth.

## Test Strategy

${STRATEGY_HEAD}
${ALL.map(strategyRow).join("\n")}

## Features

${FEATURES.map((f) => `### ${f.key} · ${f.name}\nWhy: ${f.why}\n\n${[...f.claims].sort((a, b) => Number(a.id.slice(4)) - Number(b.id.slice(4))).map(claimLine).join("\n")}`).join("\n\n")}

## Decisions

- 2026-03-01: one master for the whole product; each spec projects one feature.
- 2026-03-07: agents do not update themselves; ISC-19 is dropped.
`;
}

// ── spec folders ───────────────────────────────────────────────────────────────────────────────────────

interface SpecDef {
    dir: string; title: string; task: string; type: string; feature: string; phase: string;
    started: string; updated: string; claims: Claim[]; decisions: string[]; problem: string; goal: string;
}

const featureOf = (key: string): Feature => FEATURES.find((f) => f.key === key) as Feature;
const MERMAID = "flowchart LR\n  scheduler --> agent --> store --> page";
const needsDiagram = (type: string) => type === "feature";

function specMd(d: SpecDef): string {
    const closed = d.claims.filter((x) => x.closed);
    return `---
task: "${d.task}"
slug: ${d.dir}
spec_type: ${d.type}
isa_master: ../../ISA.md
isa_feature: ${d.feature}
constitution: ../constitution.md
phase: ${d.phase}
progress: ${progress(d.claims)}
started: ${d.started}
updated: ${d.updated}
context_sufficient: true
interview_invoked: false
---

<!-- SPEC — a derived view of ../../ISA.md (feature ${d.feature}, ${featureOf(d.feature).name}). Claim IDs belong to the
     master. Never edit the master from this file. -->

# ${d.dir.slice(0, 3)} — ${d.title}

## Problem

${d.problem}

## Goal

${d.goal}
${needsDiagram(d.type) ? `\n\`\`\`mermaid\n${MERMAID}\n\`\`\`\n` : ""}
## Claims

${d.claims.map(claimLine).join("\n")}

## Test Strategy

${STRATEGY_HEAD}
${d.claims.map(strategyRow).join("\n")}

## Decisions

${d.decisions.map((x) => `- ${x}`).join("\n")}

## Verification
${closed.length ? `\n${closed.map((x) => `- ${x.id}: \`${x.tool}\` passed, ${d.updated.slice(0, 10)}`).join("\n")}\n` : ""}`;
}

function planMd(d: SpecDef): string {
    return `---
spec: ${d.dir}
type: ${d.type}
status: approved
updated: ${d.updated}
---

# Plan ${d.dir.slice(0, 3)} — ${d.title}

**Purpose:** how the claims in \`spec.md\` get built. The what lives there; this file holds no acceptance criterion.

## Approach

One module per concern, behind the API; the status page reads the store and never the agents.

\`\`\`mermaid
${MERMAID}
\`\`\`

## Affected Files and Modules

| Path | Change | Claim |
|------|--------|-------|
${d.claims.map((x) => `| \`api/src/${d.dir.slice(4)}.ts\` | new | ${x.id} |`).join("\n")}
`;
}

interface Task { id: string; claim: Claim; lane: string; text: string; done: boolean; after?: string; struck?: string }

function tasksMd(d: SpecDef, tasks: Task[]): string {
    const line = (t: Task) => {
        const body = `${t.id} · ${t.claim.id} · ${t.lane} — ${t.text}${t.after ? ` (after: ${t.after})` : ""} · \`${t.lane}/src/${d.dir.slice(4)}.ts\``;
        return t.struck ? `- ~~${body}~~ — ${t.struck}` : `- [${t.done ? "x" : " "}] ${body}`;
    };
    return `---
spec: ${d.dir}
plan: plan.md
updated: ${d.updated}
---

# Tasks ${d.dir.slice(0, 3)} — ${d.title}

**Purpose:** atomic, checkable steps. Each task hangs on exactly one claim ID from \`spec.md\`. This file defines
nothing, it decomposes.

## Tasks

${tasks.map(line).join("\n")}
`;
}

const tasksFor = (claims: Claim[], lane = "api"): Task[] =>
    claims.map((x, i) => ({id: `T${i + 1}`, claim: x, lane, text: x.text.replace(/\.$/, "").toLowerCase(), done: x.closed}));

function reviewedMark(texts: Record<string, string>, at: string): string {
    const files = Object.fromEntries(REVIEWED_FILES.map((f) => [f, texts[f] === undefined ? null : hashForGate(f, texts[f])]));
    return JSON.stringify({gate: "reviewed", at, actor: PERSON, files}, null, 2) + "\n";
}

function staleReviewedMark(seed: string, at: string): string {
    const files = Object.fromEntries(REVIEWED_FILES.map((f) => [f, sha256(`${seed} ${f} before the last edit`)]));
    return JSON.stringify({gate: "reviewed", at, actor: PERSON, files}, null, 2) + "\n";
}

function codeReviewedMark(seed: string, at: string): string {
    return JSON.stringify({gate: "code-reviewed", at, actor: "a:claude:sess-60", tree: sha1(`${seed} tree`), head: sha1(`${seed} head`),
        branch: `feature/${seed}`, code: 0, security: 0, note: "no findings; tree changed since"}, null, 2) + "\n";
}

interface Folder { def: SpecDef; plan?: boolean; tasks?: Task[]; reviewed?: "fresh" | "stale"; reviewedAt?: string; codeReviewed?: string; events?: string[] }

const S = (dir: string, title: string, task: string, type: string, feature: string, claims: Claim[], started: string, updated: string,
    problem: string, goal: string, extra: Partial<SpecDef> = {}): SpecDef =>
    ({dir, title, task, type, feature, phase: "building", started, updated, claims, problem, goal,
        decisions: [`${started.slice(0, 10)}: opened.`], ...extra});

const event = (ts: string, from: string | null, to: string, command: string, actor: string) =>
    JSON.stringify({ts, from, to, command, actor});

const tasks005: Task[] = [
    ...tasksFor(C005.slice(0, 4)),
    {id: "T5", claim: C005_EDGE_TARGET, lane: "api", text: "sign agent results", done: false},
    {id: "T6", claim: C005_EDGE_TARGET, lane: "api", text: "reject results with a failed signature", done: false},
    {id: "T7", claim: C005_EDGE, lane: "api", text: "drop results of a revoked agent", done: false, after: "T5"},
    {id: "T8", claim: C005_DROPPED, lane: "api", text: "agent self-update channel", done: false, struck: "dropped with ISC-19, see Decisions 2026-03-07"},
];

const FOLDERS: Folder[] = [
    {def: S("001-check-scheduler", "Check scheduler", "Run every check on its interval", "feature", "F1", C001,
        "2026-03-01T09:00:00Z", "2026-03-04T16:00:00Z",
        "Checks run from a cron table that drifts and sometimes fires two checks on one host at once.",
        "Every check runs on its own interval, spread across the host, and a timeout counts as down.", {phase: "complete"}),
    plan: true, tasks: tasksFor(C001), reviewed: "fresh", reviewedAt: "2026-03-02T10:00:00Z",
    events: [
        event("2026-03-01T09:00:00Z", null, "plan", "/spec-feature check-scheduler", PERSON),
        event("2026-03-01T11:00:00Z", "plan", "tasks", "/spec-plan 001", PERSON),
        event("2026-03-01T14:00:00Z", "tasks", "review", "/spec-tasks 001", PERSON),
        event("2026-03-02T10:00:00Z", "review", "build", "/spec-review 001", PERSON),
        event("2026-03-04T12:00:00Z", "build", "code-review", "/spec-implement 001", "a:claude:sess-10"),
        event("2026-03-04T15:00:00Z", "code-review", "close", "/spec-code-review 001", PERSON),
        event("2026-03-04T16:00:00Z", "close", "done", "/spec-complete 001", PERSON),
    ]},
    {def: S("002-status-page", "Status page", "Publish the state of every public check", "feature", "F2", C002,
        "2026-03-05T09:00:00Z", "2026-03-05T09:00:00Z",
        "Users ask in chat whether a service is down; there is no page to point them to.",
        "A public page lists every public check with its state and works without script.")},
    {def: S("003-alert-rules", "Alert rules", "Send one alert per outage to the right channel", "feature", "F3", C003,
        "2026-03-05T10:00:00Z", "2026-03-08T13:25:00Z",
        "Every failed run sends a message, so one outage floods the channel and the real one is missed.",
        "An alert rule fires once per outage on the channel it names."),
    plan: true},
    {def: S("004-incident-notes", "Incident notes", "Explain an outage in words on the status page", "feature", "F4", C004,
        "2026-03-06T09:00:00Z", "2026-03-07T15:00:00Z",
        "The status page shows that a service was down but not why.",
        "Each outage can carry a note that shows on the status page, newest first."),
    plan: true, tasks: tasksFor(C004), reviewed: "stale", reviewedAt: "2026-03-06T16:00:00Z"},
    {def: S("005-probe-agents", "Probe agents", "Run checks from agents in several regions", "feature", "F5", C005,
        "2026-03-06T10:00:00Z", "2026-03-08T14:14:00Z",
        "Every check runs from one host, so a regional outage looks like a global one, or like none.",
        "Agents in several regions run checks and report signed results over one connection.",
        {decisions: ["2026-03-06: opened.", "2026-03-07: agents do not update themselves; ISC-19 is dropped and its task struck."]}),
    plan: true, tasks: tasks005, reviewed: "fresh", reviewedAt: "2026-03-07T12:00:00Z"},
    {def: S("006-retry-backoff", "Retry backoff", "Retry failed runs without counting extra outages", "refactor", "F1", C006,
        "2026-03-06T11:00:00Z", "2026-03-08T10:00:00Z",
        "A failed run is retried at once and each retry is recorded as its own outage.",
        "Retries back off exponentially and belong to the outage that caused them."),
    reviewed: "fresh", reviewedAt: "2026-03-06T13:00:00Z", codeReviewed: "2026-03-08T09:30:00Z"},
    {def: S("007-history-export", "History export formats", "Find out which export formats teams need", "spike", "F6", C007,
        "2026-03-07T09:00:00Z", "2026-03-08T09:00:00Z",
        "Teams ask for their uptime history in different formats, and nobody has listed which.",
        "A recorded table names the formats and a decision names the default."),
    reviewed: "fresh", reviewedAt: "2026-03-07T10:00:00Z"},
    {def: S("008-export-formats", "Export size limits", "Find the largest history each format exports quickly", "spike", "F6", C008,
        "2026-03-07T09:30:00Z", "2026-03-08T09:30:00Z",
        "A full history export can take minutes in some formats, and nobody knows where the limit lies.",
        "A recorded table names each format's limit, and no export exceeds it."),
    reviewed: "fresh", reviewedAt: "2026-03-07T10:30:00Z"},
    {def: S("009-timezone-labels", "Time-zone labels", "Label every time on the status page with a time zone", "bug", "F2", C009,
        "2026-03-07T11:00:00Z", "2026-03-08T11:00:00Z",
        "Times on the status page carry no zone, so a reader abroad misreads every outage window.",
        "Every time on the status page carries the viewer's time-zone label."),
    reviewed: "fresh", reviewedAt: "2026-03-07T11:30:00Z"},
    {def: S("010-renew-api-key", "Renew the mail relay key", "Replace the mail relay API key without a restart", "chore", "F7", C010,
        "2026-03-07T13:00:00Z", "2026-03-07T15:00:00Z",
        "The mail relay API key expires at the end of the month.",
        "The key is replaced and the old one revoked, with no restart."),
    reviewed: "fresh", reviewedAt: "2026-03-07T13:30:00Z"},
    {def: S("011-maintenance-windows", "Maintenance windows", "Hide planned downtime from alerts and the page", "bug", "F3", C011,
        "2026-03-07T14:00:00Z", "2026-03-07T14:00:00Z",
        "Planned maintenance shows as an outage on the status page.",
        "A maintenance window hides its outages and is announced a day ahead, once the status page exists."),
    reviewed: "fresh", reviewedAt: "2026-03-07T14:30:00Z"},
];

// ── workspace files ────────────────────────────────────────────────────────────────────────────────────

const CONSTITUTION = `---
repo: beacon
derived: 2026-03-01T08:00:00Z
standards_version: 1.0.0
design_track: app
viewports: [390, 820, 1440]
stack: [bun, typescript]
---

# Constitution — beacon

## Non-negotiables

| Rule | Source | Verdict | Probe |
|------|--------|---------|-------|
| XC-01 bun, never npm | repo \`CLAUDE.md\` | binding | \`bun run check:static\` |

## Lanes

| Lane | Path prefixes | Context a worker loads | Lane probe |
|------|---------------|------------------------|------------|
| api | \`api/\`, \`tests/\` | \`api/CLAUDE.md\` | \`bun test api/\` |
| web | \`web/\` | \`web/CLAUDE.md\` | \`bun run --cwd web test\` |
`;

const WORKFLOW = `# Workflow — beacon

| type | stages | code_review |
|------|--------|-------------|
| feature | plan · tasks · review · build · code-review · close · done | spec |
| project | plan · tasks · review · build · code-review · close · done | spec |
| infra | plan · review · build · code-review · close · done | spec |
| refactor | tasks · review · build · code-review · close · done | spec |
| bug | review · build · close · done | none |
| spike | review · build · code-review · close · done | feature |
| chore | review · build · done | none |
`;

const story = (slug: string, feature: string, priority: string, goal: string) => `---
type: feature
feature: ${feature}
priority: ${priority}
status: idea
---
/spec

## Type
feature

## Repo
beacon
Slug: ${slug}

## Goal (one sentence)
${goal}
`;

const IDEAS_INDEX = `# Ideas — beacon

The backlog: one story per file, shaped but not yet a spec.

## F2 · Status page

| Story | Milestone | Priority | Spec |
|-------|-----------|----------|------|
| uptime-badges | — | P2 | — |

## F3 · Alerting

| Story | Milestone | Priority | Spec |
|-------|-----------|----------|------|
| digest-emails | — | P3 | — |
`;

// ── the activity log ───────────────────────────────────────────────────────────────────────────────────

const day = (hm: string) => `2026-03-08T${hm}:00Z`;
const line = (o: Record<string, string>) => JSON.stringify(o);
const runStart = (hm: string, run: string, command: string, session: string, target: Record<string, string>) =>
    line({ts: day(hm), event: "run-start", run, command, session, ...target});
const runEnd = (hm: string, run: string, command: string, session: string, target: Record<string, string>, outcome: string) =>
    line({ts: day(hm), event: "run-end", run, command, session, ...target, outcome});
const taskEvent = (hm: string, event: string, claim: string, task: string, session: string, worktree: string) =>
    line({ts: day(hm), event, claim, task, session, worktree});

const on = (dir: string) => ({spec: dir});
const ACTIVITY = [
    runStart("11:40", "r-0308-1140", "/spec-code-review 006", "a:claude:sess-61", on("006-retry-backoff")),
    runStart("12:30", "r-0308-1230", "/spec-plan 002", "a:claude:sess-21", on("002-status-page")),
    runEnd("12:41", "r-0308-1230", "/spec-plan 002", "a:claude:sess-21", on("002-status-page"), "error"),
    runStart("13:00", "r-0308-1300", "/spec-plan 003", "a:claude:sess-31", on("003-alert-rules")),
    runEnd("13:25", "r-0308-1300", "/spec-plan 003", "a:claude:sess-31", on("003-alert-rules"), "ok"),
    line({ts: day("13:40"), event: "claim", claim: "ISC-16", task: "T4", session: "a:claude:sess-50/T4", worktree: "wt-4"}),
    taskEvent("13:41", "dispatch", "ISC-16", "T4", "a:claude:sess-50/T4", "wt-4"),
    runStart("14:00", "r-0308-1400", "/spec-review 004", "a:claude:sess-41", on("004-incident-notes")),
    taskEvent("14:05", "dispatch", "ISC-13", "T1", "a:claude:sess-50/T1", "wt-1"),
    taskEvent("14:06", "build", "ISC-13", "T1", "a:claude:sess-50/T1", "wt-1"),
    taskEvent("14:12", "patch", "ISC-13", "T1", "a:claude:sess-50/T1", "wt-1"),
    taskEvent("14:14", "apply", "ISC-13", "T1", "a:claude:sess-50/T1", "wt-1"),
    runStart("14:20", "r-0308-1420", "/spec-implement 005", "a:claude:sess-51", on("005-probe-agents")),
    taskEvent("14:22", "dispatch", "ISC-18", "T5", "a:claude:sess-51/T5", "wt-5"),
    taskEvent("14:23", "build", "ISC-18", "T5", "a:claude:sess-51/T5", "wt-5"),
    taskEvent("14:24", "dispatch", "ISC-18", "T6", "a:claude:sess-51/T6", "wt-6"),
    taskEvent("14:25", "build", "ISC-18", "T6", "a:claude:sess-51/T6", "wt-6"),
    runEnd("14:30", "r-0308-1400", "/spec-review 004", RELEASER, on("004-incident-notes"), "released"),
    line({ts: day("14:30"), event: "claim", claim: "ISC-15", task: "T3", session: "a:claude:sess-51/T3", worktree: "wt-3"}),
    taskEvent("14:31", "patch", "ISC-18", "T5", "a:claude:sess-51/T5", "wt-5"),
    taskEvent("14:31", "dispatch", "ISC-15", "T3", "a:claude:sess-51/T3", "wt-3"),
    taskEvent("14:32", "build", "ISC-15", "T3", "a:claude:sess-51/T3", "wt-3"),
    taskEvent("14:33", "patch", "ISC-18", "T6", "a:claude:sess-51/T6", "wt-6"),
    taskEvent("14:35", "apply", "ISC-18", "T6", "a:claude:sess-51/T6", "wt-6"),
    runStart("14:40", "r-0308-1440", "/spec-implement 005", "a:claude:sess-52", on("005-probe-agents")),
    runStart("14:45", "r-0308-1445", "/spec new uptime-badges", "a:claude:sess-71", {idea: "uptime-badges"}),
    runStart("14:52", "r-0308-1452", "/spec-tasks 003", "a:claude:sess-32", on("003-alert-rules")),
];

// ── write ──────────────────────────────────────────────────────────────────────────────────────────────

rmSync(join(ROOT, "specs"), {recursive: true, force: true});
rmSync(join(ROOT, ".spectant"), {recursive: true, force: true});
write("ISA.md", master());
write("specs/constitution.md", CONSTITUTION);
write("specs/workflow.md", WORKFLOW);
write("specs/ideas/README.md", IDEAS_INDEX);
write("specs/ideas/uptime-badges.md", story("uptime-badges", "F2", "P2", "Each public check offers a small uptime badge a project can embed in its README."));
write("specs/ideas/digest-emails.md", story("digest-emails", "F3", "P3", "The on-call person can choose one daily digest email instead of an alert per outage."));
for (const f of FOLDERS) {
    const base = `specs/${f.def.dir}`;
    const texts: Record<string, string> = {"spec.md": specMd(f.def)};
    if (f.plan) texts["plan.md"] = planMd(f.def);
    if (f.tasks) texts["tasks.md"] = tasksMd(f.def, f.tasks);
    for (const [name, text] of Object.entries(texts)) write(`${base}/${name}`, text);
    if (f.reviewed === "fresh") write(`${base}/.gates/reviewed.json`, reviewedMark(texts, f.reviewedAt as string));
    if (f.reviewed === "stale") write(`${base}/.gates/reviewed.json`, staleReviewedMark(f.def.dir, f.reviewedAt as string));
    if (f.codeReviewed) write(`${base}/.gates/code-reviewed.json`, codeReviewedMark(f.def.dir, f.codeReviewed));
    if (f.events) write(`${base}/events.jsonl`, f.events.join("\n") + "\n");
}
write(".spectant/activity.jsonl", ACTIVITY.join("\n") + "\n");
