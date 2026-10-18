/**
 * generate.ts — writes the synthetic `guidance` fixture tree next to this file (spec 020, T2).
 *
 *   bun core/fixtures/guidance/generate.ts
 *
 * Deterministic: no clock, no randomness, no environment. Every date is fixed in March 2026, before the state clock
 * 2026-03-08T15:00:00Z (`STATE_NOW` in core/tests/helpers/state-model.ts); the reviewed marks hash the generated text
 * through core/src/gates.ts, the stale and code-reviewed marks hash fixed seed strings. Running it twice produces
 * byte-identical files.
 *
 * Pylon is an invented product (a small feature-flag service with client SDKs). Nothing here is copied from a real
 * repository. The tree is the guidance fixture of spec 020 (ISC-237): it splits the `open` items of the state model
 * into "Waits on you" and "Next" and sorts both by priority, then by how long each entry waits. `specs/workflow.md`
 * gives `spike` `code_review: feature` and `bug` `code_review: none`; every other type runs its default row.
 *
 * Spec → case (priority · stage · state → list):
 *   001-flag-targeting   P1   review         open     waits  reviewed mark stale; events.jsonl into review 03-05
 *   002-audit-trail      P2   review         open     waits  reviewed mark missing; into review 03-06 (younger)
 *   003-flag-expiry      P2   review         open     waits  reviewed mark stale; into review 03-03 (older)
 *   004-cache-layer      —    code-review    open     waits  refactor, every claim closed, code-reviewed mark stale;
 *                                                             no events.jsonl: since is `updated:`
 *   005-sdk-rollout      P2   build          open     next   the spec item; and in waits: ISC-14 open with a `manual`
 *                                                             probe, T3 open in lane `operator`, T4 a `question` of
 *                                                             the newest round (round 2, 03-07); round 1 asked about
 *                                                             T2, which round 2 no longer does. ISC-13 is an ordinary
 *                                                             takeable claim. Into build 03-04
 *   006-sdk-benchmarks   —    close-pending  waiting  —      spike, every claim closed; F5 waits on 005
 *   007-segment-builder  P1   plan           open     next   feature without plan.md
 *   008-change-webhooks  P3   tasks          open     next   feature with plan.md, three claims, no tasks.md
 *   009-percent-rounding P1   review         running  —      bug, no reviewed mark; a run-start 30 minutes before the
 *                                                             clock without run-end in .spectant/activity.jsonl
 *   010-banner-copy      —    close          open     waits  bug, every claim closed, `code_review: none`; no
 *                                                             `updated:` and no events.jsonl: since is null
 *   011-flag-store       —    done           done     —      feature, `phase: complete`
 *   012-segment-export   —    blocked        waiting  —      bug, reviewed mark fresh, both claims `(after: 007)`
 *   ideas/flag-templates P1   idea           open     —      a story: ideas are in neither list
 */

import {createHash} from "node:crypto";
import {mkdirSync, rmSync, writeFileSync} from "node:fs";
import {dirname, join} from "node:path";

import {hashForGate, REVIEWED_FILES} from "../../src/gates.ts";

const ROOT = import.meta.dir;
const PERSON = "u:7b2e4f10";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const sha1 = (s: string) => createHash("sha1").update(s).digest("hex");

function write(rel: string, content: string): void {
    const path = join(ROOT, rel);
    mkdirSync(dirname(path), {recursive: true});
    writeFileSync(path, content);
}

// ── the claim register ─────────────────────────────────────────────────────────────────────────────────

interface Claim { id: string; text: string; closed: boolean; tool: string; type?: string; after?: string }
interface Feature { key: string; name: string; why: string; claims: Claim[] }

let next = 1;
const c = (text: string, closed: boolean, tool: string, extra: Partial<Claim> = {}): Claim => ({id: `ISC-${next++}`, text, closed, tool, ...extra});

const C001 = [
    c("A flag rule targets users by attribute, within one evaluation.", false, "bun test tests/targeting.test.ts -t attribute"),
    c("A rule with an unknown attribute is refused when saved.", false, "bun test tests/targeting.test.ts -t unknown"),
    c("Anti: a disabled rule still matches a user.", false, "bun test tests/targeting.test.ts -t disabled"),
];
const C002 = [
    c("Every flag change is recorded with its actor and time.", false, "bun test tests/audit.test.ts -t record"),
    c("The audit trail lists changes newest first.", false, "bun run e2e -- audit -g order"),
    c("Anti: a change is recorded without its actor.", false, "bun test tests/audit.test.ts -t actor"),
];
const C003 = [
    c("A flag carries an optional expiry date.", false, "bun test tests/expiry.test.ts -t date"),
    c("An expired flag is listed on the clean-up page.", false, "bun run e2e -- expiry -g list"),
    c("An expired flag keeps serving its last value.", false, "bun test tests/expiry.test.ts -t serve"),
];
const C004 = [
    c("Flag reads hit the cache before the store.", true, "bun test tests/cache.test.ts -t order"),
    c("Anti: a cached flag outlives its change by more than one second.", true, "bun test tests/cache.test.ts -t ttl"),
];
const C005 = [
    c("The server SDK evaluates flags locally from one snapshot.", true, "bun test tests/sdk.test.ts -t snapshot"),
    c("The browser SDK reloads its snapshot on a change event.", false, "bun test tests/sdk.test.ts -t reload"),
    c("A rollout to the staging tenant is confirmed by hand on the staging console.", false, "manual check on the staging console", {type: "manual"}),
];
const C006 = [
    c("A recorded table names the evaluation time of each SDK at ten thousand flags.", true, "bun run cli -- bench sdk"),
    c("A decision names the snapshot size limit.", true, "bun run cli -- bench sdk --decision"),
];
const C007 = [
    c("A segment is built from attribute rules in the console.", false, "bun run e2e -- segments -g build"),
    c("A segment can be reused by several flags.", false, "bun test tests/segments.test.ts -t reuse"),
    c("Anti: deleting a segment in use is allowed.", false, "bun test tests/segments.test.ts -t delete"),
];
const C008 = [
    c("A flag change sends a signed webhook.", false, "bun test tests/webhooks.test.ts -t signed"),
    c("A failed webhook is retried three times.", false, "bun test tests/webhooks.test.ts -t retry"),
    c("Anti: a webhook carries a secret value.", false, "bun test tests/webhooks.test.ts -t secret"),
];
const C009 = [
    c("A percentage rollout of 33 percent serves 33 percent of users, within one percent.", false, "bun test tests/rollout.test.ts -t percent"),
    c("Anti: a user flips between variants across evaluations.", false, "bun test tests/rollout.test.ts -t sticky"),
];
const C010 = [
    c("The stale-flag banner names the flag and its owner.", true, "bun run e2e -- banner -g copy"),
];
const C011 = [
    c("Flags are stored with their rules in one document.", true, "bun test tests/store.test.ts -t document"),
    c("A store write is atomic per flag.", true, "bun test tests/store.test.ts -t atomic"),
];
const C012 = [
    c("A segment exports as a CSV of its rules.", false, "bun test tests/segments.test.ts -t export", {after: "007"}),
    c("Anti: an export lists a user identifier.", false, "bun test tests/segments.test.ts -t privacy", {after: "007"}),
];

const FEATURES: Feature[] = [
    {key: "F1", name: "Targeting", why: "a flag reaches exactly the users it is meant for.", claims: [...C001, ...C007, ...C009, ...C012]},
    {key: "F2", name: "Audit", why: "every change to a flag can be traced to a person and a time.", claims: [...C002, ...C008]},
    {key: "F3", name: "Flag lifecycle", why: "old flags are found and removed instead of piling up.", claims: [...C003, ...C010]},
    {key: "F4", name: "Storage", why: "flag reads stay fast and writes stay consistent.", claims: [...C004, ...C011]},
    {key: "F5", name: "SDKs", why: "every service evaluates flags locally, without a call per request.", claims: [...C005, ...C006]},
];
const ALL = FEATURES.flatMap((f) => f.claims).sort((a, b) => Number(a.id.slice(4)) - Number(b.id.slice(4)));
const progress = (cs: Claim[]) => `${cs.filter((x) => x.closed).length}/${cs.length}`;

const claimLine = (x: Claim): string => `- [${x.closed ? "x" : " "}] ${x.id}: ${x.text}${x.after ? ` (after: ${x.after})` : ""}`;

const STRATEGY_HEAD = "| isc | type | check | threshold | tool | anchors_to | severity |\n|-----|------|-------|-----------|------|------------|----------|";
const typeOf = (x: Claim) => x.type ?? (x.tool.startsWith("bun test") ? "bun-test" : x.tool.startsWith("bun run e2e") ? "e2e" : "bash");
const strategyRow = (x: Claim) => `| ${x.id} | ${typeOf(x)} | ${x.text.replace(/\.$/, "").toLowerCase()} | pass | \`${x.tool}\` | literal |  |`;

// ── master ─────────────────────────────────────────────────────────────────────────────────────────────

function master(): string {
    return `---
task: "Ship feature flags to every service with Pylon"
slug: 20260301-pylon
project: pylon
phase: climbing
progress: ${progress(ALL)}
started: 2026-03-01T08:00:00Z
updated: 2026-03-08T12:00:00Z
---

# Pylon

## Problem

A small team ships features behind ad-hoc environment variables. Turning one on for a few users needs a deploy, and
nobody can say who switched what.

## Vision

Every service reads its flags from one place, a flag reaches exactly the users it targets, and every change is traced.

## Out of Scope

- Experiment statistics.

## Principles

- A flag change never needs a deploy.

## Constraints

- Bun and TypeScript; SDKs evaluate locally.

## Goal

Flags are targeted, audited, cached and evaluated locally by every SDK.

## Test Strategy

${STRATEGY_HEAD}
${ALL.map(strategyRow).join("\n")}

## Features

${FEATURES.map((f) => `### ${f.key} · ${f.name}\nWhy: ${f.why}\n\n${[...f.claims].sort((a, b) => Number(a.id.slice(4)) - Number(b.id.slice(4))).map(claimLine).join("\n")}`).join("\n\n")}

## Decisions

- 2026-03-01: one master for the whole product; each spec projects one feature.
`;
}

// ── spec folders ───────────────────────────────────────────────────────────────────────────────────────

interface SpecDef {
    dir: string; title: string; task: string; type: string; feature: string; phase: string; priority?: string;
    started: string; updated: string | null; claims: Claim[]; problem: string; goal: string;
}

const MERMAID = "flowchart LR\n  console --> api --> store --> sdk";

function specMd(d: SpecDef): string {
    const closed = d.claims.filter((x) => x.closed);
    const day = (d.updated ?? d.started).slice(0, 10);
    return `---
task: "${d.task}"
slug: ${d.dir}
spec_type: ${d.type}
isa_master: ../../ISA.md
isa_feature: ${d.feature}
constitution: ../constitution.md
phase: ${d.phase}
${d.priority ? `priority: ${d.priority}\n` : ""}progress: ${progress(d.claims)}
started: ${d.started}
${d.updated ? `updated: ${d.updated}\n` : ""}context_sufficient: true
interview_invoked: false
---

<!-- SPEC — a derived view of ../../ISA.md (feature ${d.feature}). Claim IDs belong to the master. Never edit the
     master from this file. -->

# ${d.dir.slice(0, 3)} — ${d.title}

## Problem

${d.problem}

## Goal

${d.goal}
${d.type === "feature" ? `\n\`\`\`mermaid\n${MERMAID}\n\`\`\`\n` : ""}
## Claims

${d.claims.map(claimLine).join("\n")}

## Test Strategy

${STRATEGY_HEAD}
${d.claims.map(strategyRow).join("\n")}

## Decisions

- ${d.started.slice(0, 10)}: opened.

## Verification
${closed.length ? `\n${closed.map((x) => `- ${x.id}: \`${x.tool}\` passed, ${day}`).join("\n")}\n` : ""}`;
}

function planMd(d: SpecDef): string {
    return `---
spec: ${d.dir}
type: ${d.type}
status: approved
updated: ${d.updated ?? d.started}
---

# Plan ${d.dir.slice(0, 3)} — ${d.title}

**Purpose:** how the claims in \`spec.md\` get built. The what lives there; this file holds no acceptance criterion.

## Approach

One module per concern, behind the API; the SDKs read a snapshot and never the store.

\`\`\`mermaid
${MERMAID}
\`\`\`

## Affected Files and Modules

| Path | Change | Claim |
|------|--------|-------|
${d.claims.map((x) => `| \`api/src/${d.dir.slice(4)}.ts\` | new | ${x.id} |`).join("\n")}
`;
}

interface Task { id: string; claim: Claim; lane: string; text: string; done: boolean }

function tasksMd(d: SpecDef, tasks: Task[]): string {
    const path = (t: Task) => (t.lane === "operator" ? `\`ops/${d.dir.slice(4)}.md\`` : `\`${t.lane}/src/${d.dir.slice(4)}.ts\``);
    const line = (t: Task) => `- [${t.done ? "x" : " "}] ${t.id} · ${t.claim.id} · ${t.lane} — ${t.text} · ${path(t)}`;
    return `---
spec: ${d.dir}
plan: plan.md
updated: ${d.updated ?? d.started}
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
    return JSON.stringify({gate: "code-reviewed", at, actor: "a:claude:sess-40", tree: sha1(`${seed} tree`), head: sha1(`${seed} head`),
        branch: `feature/${seed}`, code: 0, security: 0, note: "no findings; tree changed since"}, null, 2) + "\n";
}

interface Folder {
    def: SpecDef; plan?: boolean; tasks?: Task[]; reviewed?: "fresh" | "stale"; reviewedAt?: string; codeReviewed?: string;
    events?: string[]; rounds?: string[];
}

const S = (dir: string, title: string, task: string, type: string, feature: string, claims: Claim[], started: string, updated: string | null,
    problem: string, goal: string, extra: Partial<SpecDef> = {}): SpecDef =>
    ({dir, title, task, type, feature, phase: "building", started, updated, claims, problem, goal, ...extra});

const event = (ts: string, from: string | null, to: string, command: string) => JSON.stringify({ts, from, to, command, actor: PERSON});

/** The feature chain up to review: created into plan, planned, tasked, then into review on `review` (the entry's since). */
const intoReview = (n: string, slug: string, created: string, review: string) => [
    event(created, null, "plan", `/spec-feature ${slug}`),
    event(created.replace("T09", "T11"), "plan", "tasks", `/spec-plan ${n}`),
    event(review, "tasks", "review", `/spec-tasks ${n}`),
];

// 005: T1 done, T2 takeable work on ISC-13, T3 the operator step, T4 the question of the newest round.
const tasks005: Task[] = [
    {id: "T1", claim: C005[0] as Claim, lane: "api", text: "evaluate flags from one snapshot in the server sdk", done: true},
    {id: "T2", claim: C005[1] as Claim, lane: "sdk", text: "reload the browser snapshot on a change event", done: false},
    {id: "T3", claim: C005[1] as Claim, lane: "operator", text: "add the staging sdk key to the ci secrets", done: false},
    {id: "T4", claim: C005[2] as Claim, lane: "sdk", text: "roll the sdk out to the staging tenant", done: false},
];

const roundTask = (t: Task, state: string, note?: string) => ({
    id: t.id, claim: t.claim.id, lane: t.lane, seam: false, parallel: false, text: t.text, paths: [`${t.lane}/src/sdk-rollout.ts`],
    state, reason: "claim takeable, edges closed", ...(note ? {note} : {}), builder: "Engineer",
});
const T005 = (id: string) => tasks005.find((t) => t.id === id) as Task;
const ROUNDS005 = [
    JSON.stringify({v: 1, round: 1, ts: "2026-03-05T10:00:00Z", mode: "agent", width: 4, dispatched: ["T1", "T2"],
        tasks: [roundTask(T005("T1"), "closed"), roundTask(T005("T2"), "question", "question: reload on every event or debounce them?")]}),
    JSON.stringify({v: 1, round: 2, ts: "2026-03-07T10:00:00Z", mode: "agent", width: 4, dispatched: ["T2", "T4"],
        tasks: [roundTask(T005("T1"), "closed"), roundTask(T005("T2"), "open"),
            roundTask(T005("T4"), "question", "question: roll out to every staging tenant or to the first one only?")],
        stop: "a decision only the principal can make"}),
];

const FOLDERS: Folder[] = [
    {def: S("001-flag-targeting", "Flag targeting", "Target a flag at users by attribute", "feature", "F1", C001,
        "2026-03-02T09:00:00Z", "2026-03-05T12:00:00Z",
        "A flag is either on for everyone or off for everyone.",
        "A flag rule targets the users whose attributes match it.", {priority: "P1"}),
    plan: true, tasks: tasksFor(C001), reviewed: "stale", reviewedAt: "2026-03-05T11:00:00Z",
    events: intoReview("001", "flag-targeting", "2026-03-02T09:00:00Z", "2026-03-05T10:00:00Z")},
    {def: S("002-audit-trail", "Audit trail", "Record who changed which flag", "feature", "F2", C002,
        "2026-03-03T09:00:00Z", "2026-03-06T09:00:00Z",
        "Nobody can say who switched a flag on or when.",
        "Every flag change is recorded with its actor and time.", {priority: "P2"}),
    plan: true, tasks: tasksFor(C002),
    events: intoReview("002", "audit-trail", "2026-03-03T09:00:00Z", "2026-03-06T09:00:00Z")},
    {def: S("003-flag-expiry", "Flag expiry", "Let a flag expire and list it for clean-up", "feature", "F3", C003,
        "2026-03-01T09:00:00Z", "2026-03-04T08:00:00Z",
        "Flags stay in the code long after their rollout ended.",
        "A flag carries an expiry date and an expired flag is listed for clean-up.", {priority: "P2"}),
    plan: true, tasks: tasksFor(C003), reviewed: "stale", reviewedAt: "2026-03-03T15:00:00Z",
    events: intoReview("003", "flag-expiry", "2026-03-01T09:00:00Z", "2026-03-03T09:00:00Z")},
    {def: S("004-cache-layer", "Cache layer", "Read flags through a cache without serving stale values", "refactor", "F4", C004,
        "2026-03-02T10:00:00Z", "2026-03-05T16:00:00Z",
        "Every flag read goes to the store.",
        "Flag reads hit a cache that never outlives a change by more than a second."),
    reviewed: "fresh", reviewedAt: "2026-03-02T12:00:00Z", codeReviewed: "2026-03-05T15:00:00Z"},
    {def: S("005-sdk-rollout", "SDK rollout", "Evaluate flags locally in the server and browser SDKs", "feature", "F5", C005,
        "2026-03-02T09:00:00Z", "2026-03-07T10:00:00Z",
        "Every flag evaluation is a call to the API.",
        "The SDKs evaluate flags locally from one snapshot and reload it on change.", {priority: "P2"}),
    plan: true, tasks: tasks005, reviewed: "fresh", reviewedAt: "2026-03-04T12:00:00Z", rounds: ROUNDS005,
    events: [
        event("2026-03-02T09:00:00Z", null, "plan", "/spec-feature sdk-rollout"),
        event("2026-03-02T11:00:00Z", "plan", "tasks", "/spec-plan 005"),
        event("2026-03-03T09:00:00Z", "tasks", "review", "/spec-tasks 005"),
        event("2026-03-04T12:00:00Z", "review", "build", "/spec-review 005"),
    ]},
    {def: S("006-sdk-benchmarks", "SDK benchmarks", "Find the snapshot size every SDK evaluates quickly", "spike", "F5", C006,
        "2026-03-03T09:00:00Z", "2026-03-06T10:00:00Z",
        "Nobody knows how large a snapshot an SDK can evaluate quickly.",
        "A recorded table names each SDK's evaluation time and a decision names the limit."),
    reviewed: "fresh", reviewedAt: "2026-03-03T10:00:00Z"},
    {def: S("007-segment-builder", "Segment builder", "Build reusable user segments in the console", "feature", "F1", C007,
        "2026-03-06T09:00:00Z", "2026-03-06T09:00:00Z",
        "Every flag repeats the same targeting rules.",
        "A segment is built once in the console and reused by several flags.", {priority: "P1"})},
    {def: S("008-change-webhooks", "Change webhooks", "Send a signed webhook on every flag change", "feature", "F2", C008,
        "2026-03-04T09:00:00Z", "2026-03-04T14:00:00Z",
        "Other systems poll the API to notice a flag change.",
        "A flag change sends a signed webhook, retried on failure.", {priority: "P3"}),
    plan: true},
    {def: S("009-percent-rounding", "Percent rounding", "Serve a percentage rollout to the share it names", "bug", "F1", C009,
        "2026-03-07T09:00:00Z", "2026-03-07T09:00:00Z",
        "A 33 percent rollout serves 30 percent of users.",
        "A percentage rollout serves the share it names, and a user keeps their variant.", {priority: "P1"})},
    {def: S("010-banner-copy", "Stale-flag banner copy", "Name the flag and its owner in the stale-flag banner", "bug", "F3", C010,
        "2026-03-04T09:00:00Z", null,
        "The stale-flag banner says a flag is stale but not which one.",
        "The banner names the flag and its owner."),
    reviewed: "fresh", reviewedAt: "2026-03-04T10:00:00Z"},
    {def: S("011-flag-store", "Flag store", "Store each flag with its rules in one document", "feature", "F4", C011,
        "2026-03-01T09:00:00Z", "2026-03-02T16:00:00Z",
        "Flags and their rules live in separate tables that drift.",
        "A flag and its rules are one document, written atomically.", {phase: "complete"})},
    {def: S("012-segment-export", "Segment export", "Export a segment's rules as CSV", "bug", "F1", C012,
        "2026-03-07T11:00:00Z", "2026-03-07T11:00:00Z",
        "Support cannot hand a segment's rules to a customer.",
        "A segment exports as a CSV of its rules, without user identifiers, once segments exist."),
    reviewed: "fresh", reviewedAt: "2026-03-07T12:00:00Z"},
];

// ── workspace files ────────────────────────────────────────────────────────────────────────────────────

const CONSTITUTION = `---
repo: pylon
derived: 2026-03-01T08:00:00Z
standards_version: 1.0.0
design_track: app
viewports: [390, 820, 1440]
stack: [bun, typescript]
---

# Constitution — pylon

## Non-negotiables

| Rule | Source | Verdict | Probe |
|------|--------|---------|-------|
| XC-01 bun, never npm | repo \`CLAUDE.md\` | binding | \`bun run check:static\` |

## Lanes

| Lane | Path prefixes | Context a worker loads | Lane probe |
|------|---------------|------------------------|------------|
| api | \`api/\`, \`tests/\` | \`api/CLAUDE.md\` | \`bun test api/\` |
| sdk | \`sdk/\` | \`sdk/CLAUDE.md\` | \`bun test sdk/\` |
`;

const WORKFLOW = `# Workflow — pylon

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

const STORY = `---
type: feature
feature: F1
priority: P1
status: idea
---
/spec

## Type
feature

## Repo
pylon
Slug: flag-templates

## Goal (one sentence)
A new flag can start from a template that carries the team's usual targeting rules.
`;

const IDEAS_INDEX = `# Ideas — pylon

The backlog: one story per file, shaped but not yet a spec.

## F1 · Targeting

| Story | Milestone | Priority | Spec |
|-------|-----------|----------|------|
| flag-templates | — | P1 | — |
`;

// The one run: open on 009, 30 minutes before the clock 15:00, no end, so 009 is running and in neither list.
const ACTIVITY = [
    JSON.stringify({ts: "2026-03-08T14:30:00Z", event: "run-start", run: "r-0308-1430", command: "/spec-review 009", session: "a:claude:sess-91", spec: "009-percent-rounding"}),
];

// ── write ──────────────────────────────────────────────────────────────────────────────────────────────

rmSync(join(ROOT, "specs"), {recursive: true, force: true});
rmSync(join(ROOT, ".spectant"), {recursive: true, force: true});
write("ISA.md", master());
write("specs/constitution.md", CONSTITUTION);
write("specs/workflow.md", WORKFLOW);
write("specs/ideas/README.md", IDEAS_INDEX);
write("specs/ideas/flag-templates.md", STORY);
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
    if (f.rounds) write(`${base}/rounds.jsonl`, f.rounds.join("\n") + "\n");
}
write(".spectant/activity.jsonl", ACTIVITY.join("\n") + "\n");
