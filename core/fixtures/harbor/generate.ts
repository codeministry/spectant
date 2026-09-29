/**
 * generate.ts — writes the synthetic `harbor` fixture tree next to this file.
 *
 *   bun core/fixtures/harbor/generate.ts                      regenerate ISA.md and specs/ of this fixture
 *   bun core/fixtures/harbor/generate.ts --mark-reviewed <dir> write a current .gates/reviewed.json into a spec folder
 *                                                             (used for the hand-written lantern fixture)
 *
 * Deterministic: no clock, no randomness, no environment. Every date is fixed in March 2026, every hash is computed
 * from the generated text or from a fixed seed string. Running it twice produces byte-identical files.
 *
 * Harbor is an invented product (a CLI plus a small web console that mirrors container image manifests between
 * registries). Nothing here is copied from a real repository.
 *
 * What the tree exercises (see ../README.md):
 *   master ISA.md    124 claims in F0–F4, 101 closed: the three-digit/three-digit master fraction
 *   001  feature     complete, archived under specs/archive/, reviewed and code-reviewed marks, events.jsonl with
 *                    its whole chain from the creation to done in the stage table's vocabulary (T16)
 *   002  feature     building, reviewed mark current, rounds.jsonl with three rounds and a re-cut holding every card
 *                    state, .spectant/activity.jsonl with one open claim, operator tasks open and ticked,
 *                    artifacts/ with three task results and .evidence/ with a PNG, a HAR and a log (T24), four of
 *                    the six named by a verification line, the HAR by none
 *   003  refactor    scoping, no reviewed mark, plan.md and spec.md without a mermaid fence, no tasks.md
 *   004  feature     building with every claim [x], plan.md without a mermaid fence, code-reviewed mark stale
 *   005  spike       scoping, two fog lines, no reviewed mark
 *   006  bug         scoping, reviewed mark stale, one claim unknown to the master, one master claim not projected
 *   specs/tldr.md    generated before the newest spec `updated:` (stale)
 */

import {createHash} from "node:crypto";
import {existsSync, mkdirSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {dirname, join} from "node:path";

import {hashForGate, REVIEWED_FILES} from "../../src/gates.ts";

// ── reviewed-mark digest ───────────────────────────────────────────────────────────────────────────────
// The digest the old Spec skill's review gate stores comes from core/src/gates.ts (`hashForGate`, which applies
// `normalizeForGate`), so a current fixture mark is exactly what the parser verifies. The two seeded helpers below
// hash fixed strings, not spec text: they build marks that match no file on purpose.

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const sha1 = (s: string) => createHash("sha1").update(s).digest("hex");

function reviewedMark(specDir: string, at: string): string {
    const files = Object.fromEntries(REVIEWED_FILES.map((f) => {
        const p = join(specDir, f);
        return [f, existsSync(p) ? hashForGate(f, readFileSync(p, "utf-8")) : null];
    }));
    return JSON.stringify({gate: "reviewed", at, files}, null, 2) + "\n";
}

/** A reviewed mark whose hashes were taken from an earlier text of the files: stale by construction. */
function staleReviewedMark(seed: string, at: string): string {
    const files = Object.fromEntries(REVIEWED_FILES.map((f) => [f, f === "spec.md" ? sha256(`${seed} ${f} before the last edit`) : null]));
    return JSON.stringify({gate: "reviewed", at, files}, null, 2) + "\n";
}

/** A code-reviewed mark with fixed tree and head ids that match no worktree: stale for any in-memory tree hash. */
function codeReviewedMark(seed: string, at: string, branch: string, note: string): string {
    return JSON.stringify({gate: "code-reviewed", at, tree: sha1(`${seed} tree`), head: sha1(`${seed} head`), branch,
        code: 0, security: 0, note}, null, 2) + "\n";
}

// ── the claim register ─────────────────────────────────────────────────────────────────────────────────

type ProbeType = "bun-test" | "e2e" | "bash" | "browser" | "manual";

interface Claim {
    id: string;
    feature: string;
    text: string;
    closed: boolean;
    after?: string;
    probe: {type: ProbeType; check: string; threshold: string; tool: string; anchors: string; severity: string};
}

interface Feature { key: string; name: string; why: string; claims: Claim[] }

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** `xs[i]`, failing loudly instead of yielding `undefined` when `i` is out of range. */
function nth<T>(xs: readonly T[], i: number): T {
    const x = xs[i];
    if (x === undefined) throw new Error(`index ${i} out of range`);
    return x;
}

function claimLine(c: Claim): string {
    return `- [${c.closed ? "x" : " "}] ${c.id}: ${c.text}${c.after ? ` (after: ${c.after})` : ""}`;
}

function strategyRow(c: Claim): string {
    const p = c.probe;
    return `| ${c.id} | ${p.type} | ${p.check} | ${p.threshold} | ${p.tool} | ${p.anchors} | ${p.severity} |`;
}

const STRATEGY_HEAD = "| isc | type | check | threshold | tool | anchors_to | severity |\n|-----|------|-------|-----------|------|------------|----------|";

// F0 · Cross-cutting — four claims; spec 006 projects the first three, the fourth is held by no spec.
const F0: Feature = {
    key: "F0", name: "Cross-cutting",
    why: "what would sink Harbor whichever feature slipped — a half-written manifest, a silent failure or a leaked credential.",
    claims: ([
        {id: "ISC-1", text: "Anti: a failed push leaves a partial manifest visible in the target registry.",
            probe: {type: "bun-test", check: "target registry after an interrupted push", threshold: "0 partial manifests", tool: "`bun test tests/push.test.ts -t \"interrupted\"`", anchors: "derived: atomic-push", severity: "high"}},
        {id: "ISC-2", text: "Every command exits non-zero when any repository in the run failed.",
            probe: {type: "bash", check: "exit code of a run with one failing repository", threshold: "non-zero", tool: "`bun run cli -- sync --config tests/one-fails.toml; test $? -ne 0`", anchors: "literal", severity: ""}},
        {id: "ISC-3", text: "Anti: a registry credential appears in a log line, an error message or the sync history.",
            probe: {type: "bun-test", check: "credential canaries in every output channel", threshold: "0 hits", tool: "`bun test tests/redaction.test.ts`", anchors: "derived: no-leak", severity: "high"}},
        {id: "ISC-4", text: "The API and the web console bind to loopback unless `--listen` names another address.",
            probe: {type: "bun-test", check: "listen address without and with `--listen`", threshold: "2 cases", tool: "`bun test tests/listen.test.ts`", anchors: "derived: local-first", severity: ""}},
    ] satisfies Array<Omit<Claim, "feature" | "closed">>).map((c) => ({...c, feature: "F0", closed: false})),
};

function buildF1(): Feature {
    const subjects = ["a single-platform manifest", "a multi-platform index", "a manifest pinned by digest",
        "a manifest referenced by tag", "an attestation attached to a manifest", "a signature artifact",
        "a manifest larger than 4 MB", "a blob already present in the target", "a layer shared by two manifests",
        "a manifest whose source answers 404", "a registry that answers 429", "an empty repository"];
    const preds: Array<(s: string) => string> = [
        (s) => `\`harbor sync\` copies ${s} to the target registry with an identical digest.`,
        (s) => `A dry run over ${s} prints the planned push and writes nothing.`,
        (s) => `Anti: syncing ${s} twice uploads a byte the second time.`,
        (s) => `The sync log names ${s} with its source and target reference.`,
    ];
    const claims: Claim[] = [];
    for (let i = 0; i < 46; i++) {
        const n = 5 + i, s = nth(subjects, i % subjects.length), k = Math.floor(i / subjects.length) % preds.length;
        const types: ProbeType[] = ["bun-test", "bash", "bun-test", "bun-test"];
        claims.push({
            id: `ISC-${n}`, feature: "F1", text: nth(preds, k)(s), closed: true,
            after: i % 5 === 1 ? `ISC-${n - 1}` : undefined,
            probe: {type: nth(types, k), check: `${nth(["digest equality", "dry-run writes", "bytes uploaded on re-run", "log line fields"], k)} for case ${i % subjects.length + 1}`,
                threshold: nth(["equal", "0 writes", "0 bytes", "source and target named"], k),
                tool: k === 1 ? `\`bun run cli -- sync --dry-run --case ${i % subjects.length + 1} \\| rg -c PUSH\`` : `\`bun test tests/sync.test.ts -t "case ${n}"\``,
                anchors: k === 2 ? "derived: idempotent-sync" : "literal", severity: i % 9 === 0 ? "high" : ""},
        });
    }
    return {key: "F1", name: "Manifest sync",
        why: "one command mirrors every manifest a team depends on into its own registry, and running it again changes nothing.",
        claims};
}

function buildF2(): Feature {
    const subjects = ["the registry list", "the repository view", "the tag table", "the digest detail panel",
        "the sync history", "the settings page", "the search box", "the empty state", "the error banner", "the theme switch"];
    const preds: Array<(s: string) => string> = [
        (s) => `${cap(s)} renders from the API with no console error.`,
        (s) => `${cap(s)} stays usable at 390 px without horizontal scrolling.`,
        (s) => `Every interactive element in ${s} is reachable by keyboard and shows a focus ring.`,
    ];
    // IDs: ISC-51 … ISC-60, then the refinements ISC-60.1 and ISC-60.2, then ISC-61 … ISC-78 — thirty claims
    const ids = [...Array.from({length: 10}, (_, i) => `ISC-${51 + i}`), "ISC-60.1", "ISC-60.2",
        ...Array.from({length: 18}, (_, i) => `ISC-${61 + i}`)];
    const open = new Set(["ISC-74", "ISC-75", "ISC-76", "ISC-77", "ISC-78"]);
    const edges: Record<string, string> = {"ISC-60.1": "ISC-60", "ISC-60.2": "ISC-60", "ISC-66": "ISC-65", "ISC-78": "ISC-77"};
    const claims = ids.map((id, i): Claim => {
        const s = nth(subjects, i % subjects.length), k = Math.floor(i / subjects.length);
        const slug = s.replace(/^the /, "").replace(/ /g, "-");
        let text = nth(preds, k)(s);
        if (id === "ISC-60.1") text = "The theme switch follows the system colour scheme until a mode is chosen.";
        if (id === "ISC-60.2") text = "A chosen colour mode survives a reload of the console.";
        const type: ProbeType = id === "ISC-77" ? "manual" : nth<ProbeType>(["e2e", "e2e", "browser"], k);
        if (id === "ISC-60.1" || id === "ISC-60.2") {
            const sys = id === "ISC-60.1";
            return {id, feature: "F2", text, closed: true, after: edges[id],
                probe: {type: "e2e", check: `theme-switch: ${sys ? "follows the system scheme" : "mode survives reload"}`, threshold: "2 cases",
                    tool: `\`bun run e2e -- theme-switch -g ${sys ? "system" : "persist"}\``, anchors: "literal", severity: ""}};
        }
        return {
            id, feature: "F2", text, closed: !open.has(id), after: edges[id],
            probe: {type,
                check: type === "manual" ? "screen-reader pass over the sync history" : `${slug}: ${nth(["renders", "no overflow at 390 px", "keyboard reach and focus ring"], k)}`,
                threshold: type === "manual" ? "no blocker" : nth(["0 console errors", "scrollWidth == clientWidth", "all reachable"], k),
                tool: type === "manual" ? "transcript in `.evidence/`" : k === 2 ? `\`bun run test:browser -- ${slug}\`` : `\`bun run e2e -- ${slug} -g ${nth(["render", "narrow"], k)}\``,
                anchors: k === 1 ? "derived: small-screens" : "derived: console-usable", severity: id === "ISC-51" ? "high" : ""},
        };
    });
    return {key: "F2", name: "Web console",
        why: "a teammate who never touches the CLI can see what was mirrored, when, and what failed.",
        claims};
}

function buildF3(): Feature {
    const subjects = ["the project file", "the user file", "environment overrides", "command-line flags",
        "a missing file", "an unknown key", "a duplicated key"];
    const claims: Claim[] = [];
    for (let i = 0; i < 14; i++) {
        const n = 81 + i, s = nth(subjects, Math.floor(i / 2)), anti = i % 2 === 1;
        let text = anti ? `Anti: ${s} produces a different effective config than before the rewrite.` : `The loader reads ${s} through one code path.`;
        let after = anti ? `ISC-${n - 1}` : undefined;
        if (n === 94) { text = "Antecedent: the config format for version 2 is chosen and recorded as a decision."; after = undefined; }
        claims.push({id: `ISC-${n}`, feature: "F3", text, closed: false, after,
            probe: n === 94
                ? {type: "manual", check: "decision row for the config format", threshold: "present", tool: "review of `ISA.md` § Decisions", anchors: "derived: one-config-path", severity: ""}
                : {type: anti ? "bun-test" : "bash", check: anti ? `effective config snapshot, case ${i}` : `loader call sites for ${s}`,
                    threshold: anti ? "equal to the pre-rewrite snapshot" : "exactly 1",
                    tool: anti ? `\`bun test tests/config.test.ts -t "parity ${i}"\`` : "`rg -c 'loadConfig\\(' cli/src api/src`",
                    anchors: "derived: one-config-path", severity: ""}});
    }
    return {key: "F3", name: "Config loader rewrite",
        why: "the CLI, the API and the console read one config through one loader, so a setting means the same thing everywhere.",
        claims};
}

function buildF4(): Feature {
    const subjects = ["keep-last-N", "keep-newer-than", "keep-by-tag-pattern", "a protected tag", "an untagged manifest",
        "a policy preview", "a policy conflict", "a scheduled run", "a manual run", "a policy file with comments"];
    const preds: Array<(s: string) => string> = [
        (s) => `For ${s}, the retention engine evaluates every repository and logs one verdict per manifest.`,
        (s) => `Anti: ${s} deletes a manifest that another tag still references.`,
        (s) => `The console shows the effect of ${s} before anything is deleted.`,
    ];
    const claims: Claim[] = [];
    for (let i = 0; i < 30; i++) {
        const n = 95 + i, s = nth(subjects, i % subjects.length), k = Math.floor(i / subjects.length);
        claims.push({id: `ISC-${n}`, feature: "F4", text: nth(preds, k)(s), closed: true,
            after: k === 2 ? `ISC-${n - 20}` : undefined,
            probe: {type: k === 2 ? "e2e" : "bun-test", check: `${nth(["verdict log", "referenced manifests deleted", "preview shown"], k)} for ${s}`,
                threshold: nth(["one line per manifest", "0", "before delete"], k),
                tool: k === 2 ? `\`bun run e2e -- retention -g "preview ${i % subjects.length + 1}"\`` : `\`bun test tests/retention.test.ts -t "${s}"\``,
                anchors: k === 1 ? "derived: never-lose-a-referenced-manifest" : "literal", severity: k === 1 ? "high" : ""}});
    }
    return {key: "F4", name: "Retention policies",
        why: "old manifests go away on a schedule the team wrote down, and nothing still in use ever does.",
        claims};
}

const FEATURES: Feature[] = [F0, buildF1(), buildF2(), buildF3(), buildF4()];
const ALL: Claim[] = FEATURES.flatMap((f) => f.claims);
const byId = new Map(ALL.map((c) => [c.id, c]));
const claim = (id: string) => { const c = byId.get(id); if (!c) throw new Error(`no claim ${id}`); return c; };
const feature = (key: string) => { const f = FEATURES.find((x) => x.key === key); if (!f) throw new Error(`no feature ${key}`); return f; };
const range = (from: number, to: number) => Array.from({length: to - from + 1}, (_, i) => claim(`ISC-${from + i}`));
const progress = (cs: Claim[]) => `${cs.filter((c) => c.closed).length}/${cs.length}`;

// the claim spec 006 holds that the master never minted
const UNKNOWN: Claim = {id: "ISC-125", feature: "F0", closed: false,
    text: "Anti: a retried push after a timeout creates a second tag pointing at a different digest.",
    probe: {type: "bun-test", check: "tags after a timed-out push and its retry", threshold: "1 tag, 1 digest", tool: "`bun test tests/push.test.ts -t \"retry\"`", anchors: "derived: atomic-push", severity: "high"}};

// ── writing ────────────────────────────────────────────────────────────────────────────────────────────

const ROOT = import.meta.dir;
const written: string[] = [];

function write(rel: string, content: string) {
    const p = join(ROOT, rel);
    mkdirSync(dirname(p), {recursive: true});
    writeFileSync(p, content.endsWith("\n") ? content : content + "\n");
    written.push(rel);
}

function writeBytes(rel: string, content: Uint8Array) {
    const p = join(ROOT, rel);
    mkdirSync(dirname(p), {recursive: true});
    writeFileSync(p, content);
    written.push(rel);
}

const verificationStub = (c: Claim, date: string) => `- ${c.id}: ${c.probe.tool.replace(/\\\|/g, "|")} passed, ${date}`;

// ── master ─────────────────────────────────────────────────────────────────────────────────────────────

function master(): string {
    const closedDates: Record<string, string> = {F1: "2026-03-05", F2: "2026-03-08", F4: "2026-03-08"};
    return `---
task: "Mirror container manifests between registries with Harbor"
slug: 20260302-harbor
project: harbor
phase: climbing
progress: ${progress(ALL)}
started: 2026-03-02T08:00:00Z
updated: 2026-03-09T17:30:00Z
---

# Harbor

## Problem

Teams that build on public base images pull them from registries they do not control. When an upstream tag moves or
a registry rate-limits, builds break in ways nobody can reproduce. Copying images by hand is slow, easy to get wrong,
and leaves no record of what was copied when.

## Vision

One command, \`harbor sync\`, mirrors every manifest a team depends on into its own registry, byte for byte, and running
it again is a no-op. A small web console shows what was mirrored and what failed, and retention policies keep the
mirror from growing without bound.

## Out of Scope

- Building images. Harbor copies what exists; it never runs a build.
- A hosted service. Harbor runs where the team runs it.

## Principles

- A manifest is either fully present in the target or not at all.
- The registry is the truth; Harbor's own state is a cache that can be rebuilt.

## Constraints

- Bun and TypeScript for the CLI, the API and the console.
- No credential is ever written to a log, an error or the history.

## Goal

A team lists its upstream images once, runs \`harbor sync\` on a schedule, and every build pulls from its own registry
with identical digests, while the console shows each run and retention keeps the mirror bounded.

## Not yet specified

- fog: which config format version 2 uses — the spike in spec 005 has to name the trade-off first
- fog: whether a policy file may include another — depends on the config format decision

## Test Strategy

${STRATEGY_HEAD}
${ALL.map(strategyRow).join("\n")}

## Features

${FEATURES.map((f) => `### ${f.key} · ${f.name}
Why: ${f.why}

${f.claims.map(claimLine).join("\n")}`).join("\n\n")}

## Decisions

- 2026-03-02: features split into sync, console, config loader and retention; cross-cutting claims in F0.
- 2026-03-05: spec 001 closed and archived; sync is idempotent on digest, not on tag.
- 2026-03-07: refined: the console's colour mode is a stored setting (ISC-60.1, ISC-60.2).

## Verification

${ALL.filter((c) => c.closed).map((c) => verificationStub(c, closedDates[c.feature] ?? "")).join("\n")}

## Remaining Work

- [ ] Publish a sample config for the three most common registries — waits on the config format decision (spec 005).
`;
}

// ── specs ──────────────────────────────────────────────────────────────────────────────────────────────

interface SpecDef {
    dir: string;          // relative to specs/
    slug: string;
    title: string;
    task: string;
    type: "feature" | "refactor" | "spike" | "bug";
    feature: string;
    phase: "scoping" | "building" | "complete";
    started: string;
    updated: string;
    claims: Claim[];
    archived?: string;
    body: (claims: Claim[]) => string;   // everything between the title and ## Test Strategy
    after?: string;                      // sections between ## Test Strategy and ## Decisions (claims block)
    decisions: string[];
    verifiedOn: string;
    verificationNotes?: Readonly<Record<string, string>>; // appended to a closed claim's verification line
    grouped: boolean;                    // claims under ## Features (### block) or flat ## Claims
}

function specMd(d: SpecDef): string {
    const f = feature(d.feature);
    const claimBlock = d.grouped
        ? `## Features\n\n### ${f.key} · ${f.name}\nWhy: ${f.why}\n\n${d.claims.map(claimLine).join("\n")}`
        : `## Claims\n\n${d.claims.map(claimLine).join("\n")}`;
    const verification = d.claims.filter((c) => c.closed).map((c) => {
        const note = d.verificationNotes?.[c.id];
        return verificationStub(c, d.verifiedOn) + (note ? `; ${note}` : "");
    }).join("\n");
    return `---
task: "${d.task}"
slug: ${d.slug}
spec_type: ${d.type}
isa_master: ../../ISA.md
isa_feature: ${d.feature}
constitution: ../constitution.md
phase: ${d.phase}
progress: ${progress(d.claims)}
started: ${d.started}
updated: ${d.updated}
${d.archived ? `archived: ${d.archived}\n` : ""}context_sufficient: true
interview_invoked: false
context_log: context.md
---

<!-- SPEC — a derived view of ../../ISA.md (feature ${d.feature}). Claim IDs belong to the master.
     Sync: Skill("Spec", "sync ${d.slug}"). Never edit the master from this file. -->

# ${d.slug.slice(0, 3)} — ${d.title}

${d.body(d.claims).trim()}

${d.grouped ? "" : `${claimBlock}\n\n`}## Test Strategy

${STRATEGY_HEAD}
${d.claims.map(strategyRow).join("\n")}

${d.grouped ? `${claimBlock}\n\n` : ""}## Decisions

${d.decisions.map((x) => `- ${x}`).join("\n")}

## Verification
${verification ? `\n${verification}\n` : ""}`;
}

function contextMd(d: SpecDef, goal: string): string {
    return `---
spec: ${d.slug}
created: ${d.started}
updated: ${d.updated}
rounds: 1
---

<!-- CONTEXT LOG — a record, not an authority. Nothing here gates anything and nothing
     reads it back. Every answer that changes the build lives in spec.md or plan.md. -->

# Context ${d.slug.slice(0, 3)} — ${d.title}

## Goal — confirmed ${d.started}
${goal}

## Round 1 — no gaps the repo could not close, ${d.started}
`;
}

interface PlanDef { slug: string; type: string; status: string; updated: string; title: string; approach: string;
    mermaid: string | null; files: Array<[string, string, string]>; risks: Array<[string, string, string, string]> }

function planMd(p: PlanDef): string {
    return `---
spec: ${p.slug}
type: ${p.type}
status: ${p.status}
updated: ${p.updated}
---

# Plan ${p.slug.slice(0, 3)} — ${p.title}

**Purpose:** how the claims in \`spec.md\` get built. The what lives there; this file holds no acceptance criterion.

## Approach

${p.approach}
${p.mermaid ? `\n\`\`\`mermaid\n${p.mermaid}\n\`\`\`\n` : ""}
## Affected Files and Modules

| Path | Change | Claim |
|------|--------|-------|
${p.files.map(([a, b, c]) => `| \`${a}\` | ${b} | ${c} |`).join("\n")}

## Risks

| Risk | Blast radius | Early warning | Mitigation |
|------|--------------|---------------|------------|
${p.risks.map((r) => `| ${r.join(" | ")} |`).join("\n")}
`;
}

/** A task line; `struck` makes it a struck bullet (no box, no fraction, no probe mapping row) with that note. */
interface Task { id: string; claim: Claim; lane: string; text: string; path: string; seam?: boolean; parallel?: boolean; after?: string[]; done: boolean; struck?: string }

function taskLine(t: Task): string {
    const marks = [t.seam ? "[seam]" : null, t.parallel ? "[P]" : null].filter(Boolean);
    const body = `${t.id} · ${t.claim.id} · ${marks.length ? marks.join(" · ") + " · " : ""}${t.lane} — ${t.text}${t.after?.length ? ` (after: ${t.after.join(", ")})` : ""} · \`${t.path}\``;
    return t.struck === undefined ? `- [${t.done ? "x" : " "}] ${body}` : `- ~~${body}~~ — ${t.struck}`;
}

function tasksMd(slug: string, title: string, updated: string, tasks: Task[]): string {
    const byClaim = new Map<string, Task[]>();
    for (const t of tasks.filter((t) => t.struck === undefined)) byClaim.set(t.claim.id, [...(byClaim.get(t.claim.id) ?? []), t]);
    return `---
spec: ${slug}
plan: plan.md
updated: ${updated}
---

# Tasks ${slug.slice(0, 3)} — ${title}

**Purpose:** atomic, checkable steps. Each task hangs on exactly one claim ID from \`spec.md\`. This file defines
nothing, it decomposes.

## Legend

\`[P]\` = parallelizable. \`(after: T…)\` = must run after that task. \`· <lane>\` = derived from the path column via the
constitution's \`## Lanes\`. \`[seam]\` = the contract between two lanes; nothing across it runs before it.

## Tasks

${tasks.map(taskLine).join("\n")}

## Probe Mapping

| Task | Claim | Probe (from \`spec.md\` § Test Strategy) |
|------|-------|----------------------------------------|
${[...byClaim].map(([id, ts]) => `| ${ts.map((t) => t.id).join(", ")} | ${id} | ${claim(id).probe.tool} |`).join("\n")}
`;
}

/** One task per claim, lane from the claim's feature, the first task a seam when `seam` is given. */
function tasksFor(claims: Claim[], lane: (c: Claim, i: number) => string, path: (c: Claim, i: number) => string,
    verb: (c: Claim) => string, seam?: {lane: string; path: string; text: string}): Task[] {
    const out: Task[] = [];
    if (seam) out.push({id: "T1", claim: nth(claims, 0), lane: seam.lane, text: seam.text, path: seam.path, seam: true, done: nth(claims, 0).closed});
    const idOf = new Map<string, string>();
    claims.forEach((c, i) => {
        const id = `T${out.length + 1}`;
        idOf.set(c.id, id);
        const prev = c.after ? idOf.get(c.after) : undefined;
        const after = [...(seam ? ["T1"] : []), ...(prev ? [prev] : [])];
        out.push({id, claim: c, lane: lane(c, i), text: verb(c), path: path(c, i), after, parallel: !c.after, done: c.closed});
    });
    // [P] only when no claim edge holds the task and no other task names the same file (SpecFormat § tasks.md, rule 4)
    const perPath = new Map<string, number>();
    for (const t of out) perPath.set(t.path, (perPath.get(t.path) ?? 0) + 1);
    for (const t of out) t.parallel = !t.seam && !!t.parallel && perPath.get(t.path) === 1;
    return out;
}

// ── the six specs ──────────────────────────────────────────────────────────────────────────────────────

const S001: SpecDef = {
    dir: "archive/001-manifest-sync", slug: "001-manifest-sync", title: "Manifest sync",
    task: "Mirror every listed manifest into the team registry with one command", type: "feature", feature: "F1",
    phase: "complete", started: "2026-03-02T09:00:00Z", updated: "2026-03-05T15:00:00Z", archived: "2026-03-05",
    claims: feature("F1").claims, grouped: true, verifiedOn: "2026-03-05",
    decisions: ["2026-03-02: sync compares digests, never tags, so a moved upstream tag is copied again.",
        "2026-03-05: closed; every claim green on its probe."],
    body: () => `## Problem

Copying images between registries by hand loses digests, repeats uploads and leaves no log.

## Vision

\`\`\`mermaid
flowchart LR
    A[harbor.toml] --> B[harbor sync]
    B --> C{digest in target?}
    C -- yes --> D[skip, log]
    C -- no --> E[copy blobs, then manifest]
    E --> D
\`\`\`

## Out of Scope

- Retention; spec 004 owns it.

## Constraints

- A manifest is pushed only after every blob it references is present.

## Goal

\`harbor sync\` mirrors every listed manifest with an identical digest, and a second run uploads nothing.`,
};

const S002: SpecDef = {
    dir: "002-web-console", slug: "002-web-console", title: "Web console",
    task: "Show every sync run and its failures in a small web console", type: "feature", feature: "F2",
    phase: "building", started: "2026-03-03T10:00:00Z", updated: "2026-03-08T16:45:00Z",
    claims: feature("F2").claims, grouped: true, verifiedOn: "2026-03-08",
    // The evidence listing (T24) groups a file under the claim whose verification line names it: by its path relative
    // to the spec folder, or by its bare file name (ISC-72). `.evidence/dashboard.har` is named by none: ungrouped.
    verificationNotes: {
        "ISC-60.1": "model in `artifacts/T12-dashboard-model.md`",
        "ISC-60.2": "routes in `artifacts/T13-routes.md`",
        "ISC-61": "screenshot `.evidence/kpi-band-390.png`",
        "ISC-65": "report in `artifacts/T18-e2e-report.md`",
        "ISC-72": "run log bun-test-r3.log",
    },
    decisions: ["2026-03-03: the console reads the API only; it never opens the history file itself.",
        "2026-03-07: refined: the colour mode is a stored setting (ISC-60.1, ISC-60.2).",
        "2026-03-07: tasks re-cut after round 2: T27 (registry-list focus order) struck, covered by T22's keyboard probe; T28–T33 renumbered to T27–T32."],
    body: () => `## Problem

The sync log is a text file on one machine. A teammate who does not run the CLI cannot see what was mirrored or
why a run failed.

## Vision

\`\`\`mermaid
flowchart LR
    U[teammate] --> R[registry list]
    R --> V[repository view]
    V --> T[tag table]
    T --> D[digest detail]
    R --> H[sync history]
\`\`\`

## Out of Scope

- Triggering a sync from the console.
- Editing retention policies in the browser.

## Constraints

- The console is served by the API on loopback, as the cross-cutting claims require.
- It works at 390 px and with the keyboard alone.

## Goal

A teammate opens the console, finds any mirrored repository in two steps, and sees each sync run with its failures,
on a phone-sized screen and with the keyboard alone.`,
};

const S003: SpecDef = {
    dir: "003-config-loader", slug: "003-config-loader", title: "Config loader rewrite",
    task: "Read the config through one loader in the CLI, the API and the console", type: "refactor", feature: "F3",
    phase: "scoping", started: "2026-03-06T09:00:00Z", updated: "2026-03-09T17:30:00Z",
    claims: range(81, 93), grouped: false, verifiedOn: "",
    decisions: ["2026-03-06: behaviour is held; every Anti: claim compares against a snapshot taken before the rewrite."],
    body: () => `## Problem

Three packages parse \`harbor.toml\` on their own, and they disagree about environment overrides and duplicated keys.

## Out of Scope

- A new config format; spec 005 decides whether one comes.

## Goal

The CLI, the API and the console read their configuration through one loader, and the effective config for every
case in the snapshot corpus is unchanged.`,
};

const S004: SpecDef = {
    dir: "004-retention-policies", slug: "004-retention-policies", title: "Retention policies",
    task: "Delete old manifests on a written schedule without touching referenced ones", type: "feature", feature: "F4",
    phase: "building", started: "2026-03-04T08:30:00Z", updated: "2026-03-08T12:00:00Z",
    claims: feature("F4").claims, grouped: true, verifiedOn: "2026-03-08",
    decisions: ["2026-03-04: a manifest referenced by any tag is never a deletion candidate, whatever the policy says."],
    body: () => `## Problem

The mirror only grows. Old manifests pile up until the registry's quota stops the next sync.

## Vision

\`\`\`mermaid
stateDiagram-v2
    [*] --> Candidate
    Candidate --> Protected: referenced by a tag
    Candidate --> Previewed: policy matches
    Previewed --> Deleted: run confirmed
    Protected --> [*]
    Deleted --> [*]
\`\`\`

## Out of Scope

- Deleting blobs; the registry's own garbage collection does that.

## Constraints

- Every deletion is previewed in the console first.

## Goal

A team writes its retention policy once, sees its effect before anything goes, and no manifest that a tag still
references is ever deleted.`,
};

const S005: SpecDef = {
    dir: "005-config-format-choice", slug: "005-config-format-choice", title: "Config format choice",
    task: "Decide which config format version 2 uses", type: "spike", feature: "F3",
    phase: "scoping", started: "2026-03-07T13:00:00Z", updated: "2026-03-07T14:00:00Z",
    claims: [claim("ISC-94")], grouped: false, verifiedOn: "",
    decisions: ["2026-03-07: opened; the decision this spike makes possible is the loader's input format."],
    body: () => `## Problem

The rewrite in spec 003 keeps today's format. Version 2 needs includes and comments that survive a round trip,
and nobody has compared the candidates yet.

## Goal

A recorded decision names the config format for version 2 and the one trade-off that decided it.

## Not yet specified

- fog: whether includes are resolved relative to the including file or to the working directory — needs one real multi-repository config
- fog: whether a comment-preserving writer is required at all — depends on whether the console ever edits the config`,
};

const S006: SpecDef = {
    dir: "006-partial-push", slug: "006-partial-push", title: "Partial push after a timeout",
    task: "Stop a timed-out push from leaving a half-written manifest behind", type: "bug", feature: "F0",
    phase: "scoping", started: "2026-03-08T09:00:00Z", updated: "2026-03-09T10:15:00Z",
    claims: [claim("ISC-1"), claim("ISC-2"), claim("ISC-3"), UNKNOWN], grouped: false, verifiedOn: "",
    decisions: ["2026-03-08: reproduced against a registry stub that drops the connection after the second blob."],
    body: () => `## Problem

When the target registry drops the connection mid-push, the manifest is written before its last blob, and the
retry creates a second tag.

## Goal

A push interrupted at any point leaves the target registry exactly as it was before the push started.`,
};

const SPECS = [S001, S002, S003, S004, S005, S006];

// ── spec 002: the re-cut, rounds.jsonl and the live layer ──────────────────────────────────────────────
// One fixture holds every card state of the round board (ISC-88): waiting (`held`), dispatched, question, concerns,
// fail, done and closed in the rounds; running from `.spectant/activity.jsonl`; absent from the re-cut; operator open
// and done from tasks.md.
//
// Between rounds 2 and 3 the tasks were re-cut: T27 (registry-list focus order) was struck as covered by T22's
// keyboard probe, and T28–T33 were renumbered to T27–T32. Rounds 1–2 carry the ids before the re-cut, round 3 and
// tasks.md the ids after it: T33 is gone from then on, and T27–T32 name other tasks than they did before.
//
// The re-cut also added T34 (a new id past the old T33, so no id of rounds 1–2 is reused for it), a second ISC-78 task
// held in round 3 behind the open operator pass T31. After round 3 it was struck as covered by T32's probe: a struck
// task still on the last board, so the live frame shows it `absent` (ISC-88) while the rounds record it waiting.

const WIDTH_002 = 10;
const OPERATOR_REASON = "operator lane — the principal's own action, never auto-dispatched";

/** The tasks of 002 as rounds 1–2 recorded them (`before`) and as tasks.md holds them after the re-cut (`after`). */
function tasks002(): {before: Task[]; after: Task[]} {
    const base = tasksFor(S002.claims, () => "web", (c) => `web/src/app/${nth(c.probe.check.split(":"), 0)}/`,
        (c) => `${c.probe.check} (${c.id})`,
        {lane: "api", path: "api/src/history.contract.ts", text: "history endpoint contract: run, repository, digest, failure"});
    const kept = base.slice(0, 29); // T1 … T29, up to the task of ISC-76
    const tail = (first: number): Task[] => [
        {id: `T${first}`, claim: claim("ISC-77"), lane: "operator", text: "set up the screen-reader profile on the test device",
            path: "tests/manual/screen-reader-setup.md", parallel: true, done: true},
        {id: `T${first + 1}`, claim: claim("ISC-77"), lane: "operator", text: "screen-reader pass over the sync history (ISC-77)",
            path: "tests/manual/screen-reader.md", after: ["T1", `T${first}`], done: false},
        {id: `T${first + 2}`, claim: claim("ISC-78"), lane: "web", text: "theme-switch: keyboard reach and focus ring (ISC-78)",
            path: "web/src/app/theme-switch/", after: ["T1", `T${first + 1}`], done: false},
    ];
    const struck: Task = {id: "T27", claim: claim("ISC-69"), lane: "web", text: "registry-list: focus order follows the list rows (ISC-69)",
        path: "web/src/app/registry-list/", after: ["T1"], done: false};
    const renumbered = kept.slice(26).map((t) => ({...t, id: `T${Number(t.id.slice(1)) + 1}`}));
    const dropped: Task = {id: "T34", claim: claim("ISC-78"), lane: "web", text: "theme-switch: focus ring visible in forced-colours mode (ISC-78)",
        path: "web/src/app/theme-switch/", after: ["T1", "T31"], done: false, struck: "struck 2026-03-08: covered by T32's keyboard probe"};
    return {before: [...kept.slice(0, 26), struck, ...renumbered, ...tail(31)], after: [...kept, ...tail(30), dropped]};
}

type RoundState = "held" | "dispatched" | "question" | "concerns" | "fail" | "done" | "closed";

interface TaskRecord { state: RoundState; reason: string; note?: string; builder?: string; reader?: string; verdict?: string }

/** What came back for a task this round; a task in `outcomes` but not dispatched changed without an agent (a tick). */
type Outcome = Omit<TaskRecord, "reason" | "state"> & {state: Exclude<RoundState, "held" | "closed">};

interface RoundDef { ts: string; tasks: Task[]; dispatched: string[]; outcomes: Record<string, Outcome>; closes: string[]; stop?: string }

/**
 * One whole-board line per round, as the old skill appends them. A task's record follows its claim and text, not its
 * id, so a renumbered task keeps its own history and a reused id inherits none (ISC-91). Landed tasks stay landed, and
 * question, concerns and fail carry forward with their note until the task is redispatched.
 */
function roundsFor002(defs: RoundDef[], claims: Claim[]): string {
    const history = new Map<string, TaskRecord>();
    const closed = new Set<string>();
    const key = (t: Task) => `${t.claim.id} ${t.text}`;
    return defs.map((d, r) => {
        const inRound = new Map(d.tasks.map((t) => [t.id, t]));
        for (const id of [...d.dispatched, ...Object.keys(d.outcomes)]) if (!inRound.has(id)) throw new Error(`R${r + 1}: no task ${id}`);
        if (d.dispatched.length > WIDTH_002) throw new Error(`R${r + 1}: ${d.dispatched.length} dispatched, width ${WIDTH_002}`);
        const landed = (id: string) => {
            const t = inRound.get(id);
            const s = t ? history.get(key(t))?.state : undefined;
            return s === "done" || s === "closed";
        };
        // the plan's reason, as it stood before the round; the first round sends the seam out with its fan-out, as the
        // rounds this fixture replaces did, so an edge on a seam dispatched in the same round holds nothing
        const heldReason = (t: Task) => {
            if (t.lane === "operator") return OPERATOR_REASON;
            const open = (t.after ?? []).filter((a) => !landed(a) && !(inRound.get(a)?.seam && d.dispatched.includes(a)));
            return open.length ? `after ${open.join(", ")} still open` : `width ${WIDTH_002} reached`;
        };
        const dispatchReason = (t: Task) => t.seam ? "seam — runs alone before its fan-out"
            : t.parallel ? "[P], claim takeable, edges closed" : "claim takeable, edges closed";
        for (const c of d.closes) closed.add(c);

        const records = d.tasks.map((t): TaskRecord => {
            const prev = history.get(key(t));
            const out = d.outcomes[t.id];
            let rec: TaskRecord;
            if (d.dispatched.includes(t.id)) {
                if (!out) throw new Error(`R${r + 1}: ${t.id} dispatched without an outcome`);
                rec = {...out, reason: dispatchReason(t)};
            } else if (out) rec = {...out, reason: prev?.reason ?? heldReason(t)};
            else if (prev && prev.state !== "held") rec = {...prev};
            else rec = {state: "held", reason: heldReason(t)};
            if (rec.state === "done" && closed.has(t.claim.id)) rec.state = "closed";
            return rec;
        });
        for (const c of d.closes) {
            const open = d.tasks.filter((t, i) => t.claim.id === c && nth(records, i).state !== "closed");
            if (open.length) throw new Error(`R${r + 1}: ${c} closes with ${open.map((t) => t.id).join(", ")} not landed`);
        }
        d.tasks.forEach((t, i) => history.set(key(t), nth(records, i)));

        const line = {
            v: 1, round: r + 1, ts: d.ts, mode: "agent", width: WIDTH_002, dispatched: d.dispatched,
            tasks: d.tasks.map((t, i) => {
                const {state, reason, note, builder, reader, verdict} = nth(records, i);
                return {id: t.id, claim: t.claim.id, lane: t.lane, seam: !!t.seam, parallel: !!t.parallel, text: t.text, paths: [t.path],
                    state, reason, ...(note ? {note} : {}), ...(builder ? {builder} : {}), ...(reader ? {reader} : {}), ...(verdict ? {verdict} : {})};
            }),
            claims: {closed: claims.filter((c) => closed.has(c.id)).map((c) => c.id), open: claims.filter((c) => !closed.has(c.id)).map((c) => c.id),
                closed_this_round: claims.filter((c) => d.closes.includes(c.id)).map((c) => c.id)},
            progress: `${closed.size}/${claims.length}`,
            ...(d.stop ? {stop: d.stop} : {}),
        };
        return JSON.stringify(line);
    }).join("\n") + "\n";
}

function rounds002(t: {before: Task[]; after: Task[]}): string {
    const landed = (extra: Omit<Outcome, "state"> = {}): Outcome => ({state: "done", builder: "Engineer", ...extra});
    const all = (ids: string[], o: () => Outcome) => Object.fromEntries(ids.map((id) => [id, o()]));
    const r1 = ["T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8", "T9", "T10"];
    const r2 = ["T11", "T14", "T15", "T16", "T17", "T18", "T20", "T22", "T23", "T30"];
    const r3 = ["T12", "T13", "T14", "T17", "T19", "T21", "T24", "T25", "T26", "T27"];
    return roundsFor002([
        {ts: "2026-03-06T09:10:00Z", tasks: t.before, dispatched: r1, outcomes: all(r1, landed),
            closes: ["ISC-51", "ISC-52", "ISC-53", "ISC-54", "ISC-55", "ISC-56", "ISC-57", "ISC-58", "ISC-59"]},
        {ts: "2026-03-07T11:20:00Z", tasks: t.before, dispatched: r2, outcomes: {
            ...all(r2, landed),
            T14: {state: "fail", builder: "Engineer",
                note: "probe exit 1 — `bun run e2e -- tag-table -g narrow` · the digest column overflows at 390 px"},
            T17: {state: "concerns", builder: "Engineer", reader: "Forge", verdict: "concerns",
                note: "minor: the German labels push the save button past 390 px"},
            T30: {state: "question", builder: "Engineer",
                note: "question: should the empty state link to the sync docs or to the settings page?"},
        }, closes: ["ISC-60", "ISC-62", "ISC-63", "ISC-65", "ISC-67", "ISC-70"]},
        {ts: "2026-03-08T16:30:00Z", tasks: t.after, dispatched: r3, outcomes: {
            ...all(r3, landed),
            T14: landed({builder: "Anvil", reader: "Forge", verdict: "pass",
                note: "retry with: probe exit 1 — wrap the digest column below 480 px"}),
            T17: landed({reader: "Forge", verdict: "pass",
                note: "retry with: concerns — let the settings form stack its labels at 390 px"}),
            T24: landed({reader: "Forge", verdict: "skipped"}),
            T27: {state: "dispatched", builder: "Engineer"},
            T30: {state: "done"}, // ticked by the principal; ISC-77 stays open until the pass (T31)
        }, closes: ["ISC-60.1", "ISC-60.2", "ISC-61", "ISC-64", "ISC-66", "ISC-68", "ISC-69", "ISC-71", "ISC-72", "ISC-73"],
        stop: "a decision only the principal can make"},
    ], S002.claims);
}

/** `.spectant/activity.jsonl` at the repository root: T27 of round 3 still out, T25 claimed and released. */
const ACTIVITY_002 = [
    {ts: "2026-03-08T14:05:00Z", event: "claim", claim: "ISC-72", task: "T25", session: "spec-002-ISC-72", worktree: "wt-6"},
    {ts: "2026-03-08T14:06:00Z", event: "claim", claim: "ISC-74", task: "T27", session: "spec-002-ISC-74", worktree: "wt-7"},
    {ts: "2026-03-08T15:52:00Z", event: "release", claim: "ISC-72", session: "spec-002-ISC-72"},
].map((line) => JSON.stringify(line)).join("\n") + "\n";

// ── spec 001: events.jsonl (T16) ───────────────────────────────────────────────────────────────────────
// Every recorded stage transition of the archived spec, in the stage table's names (one vocabulary for timeline and
// stage). The chain is the one the files derive (created → plan … close → done); the recording dates the two steps the
// files cannot (plan and tasks written the morning of 03-02, the last claim closed 03-05 at noon) and matches the
// dated ones: `started:`, both gate marks' `at` and `updated:`. The creation is the only null `from`.

const EVENTS_001 = [
    {ts: "2026-03-02T09:00:00Z", from: null, to: "plan", command: "/spec-feature manifest-sync", actor: "principal"},
    {ts: "2026-03-02T09:40:00Z", from: "plan", to: "tasks", command: "/spec-plan 001", actor: "principal"},
    {ts: "2026-03-02T10:20:00Z", from: "tasks", to: "review", command: "/spec-tasks 001", actor: "principal"},
    {ts: "2026-03-02T11:00:00Z", from: "review", to: "build", command: "/spec-review 001", actor: "principal"},
    {ts: "2026-03-05T12:10:00Z", from: "build", to: "code-review", command: "/spec-implement 001", actor: "agent"},
    {ts: "2026-03-05T14:30:00Z", from: "code-review", to: "close", command: "/spec-code-review 001", actor: "principal"},
    {ts: "2026-03-05T15:00:00Z", from: "close", to: "done", command: "/spec-complete 001", actor: "principal"},
].map((e) => JSON.stringify(e)).join("\n") + "\n";

// ── spec 002: artifacts/ and .evidence/ (T24) ──────────────────────────────────────────────────────────

/** Task results, one Markdown file per task, named `T<n>-<what>.md`. */
const ARTIFACTS_002: Record<string, string> = {
    "T12-dashboard-model.md": `# T12 — dashboard model

Recorded 2026-03-06, round 2.

The console reads the colour mode once at start: the stored setting when there is one, else the system scheme.

| field | holds |
|-------|-------|
| \`mode\` | \`light\`, \`dark\` or \`system\` as stored |
| \`resolved\` | \`light\` or \`dark\` after the system scheme is applied |
| \`source\` | \`setting\` or \`system\` |
`,
    "T13-routes.md": `# T13 — routes

Recorded 2026-03-06, round 2.

| path | view |
|------|------|
| \`/\` | registry list |
| \`/r/:registry\` | repository view |
| \`/r/:registry/:repo\` | tag table |
| \`/history\` | sync history |
| \`/settings\` | settings page |

The colour mode is part of the settings, not of the route, so a reload keeps it.
`,
    "T18-e2e-report.md": `# T18 — e2e report

Recorded 2026-03-08, round 3.

- \`bun run e2e -- search-box -g narrow\`: 2 passed, 0 failed.
- Viewport 390 × 844: \`scrollWidth\` 390, \`clientWidth\` 390.
- The search box wraps its hint under the field below 420 px.
`,
};

/** A minimal HAR 1.2 log of one history request, fixed timestamps, loopback only. */
const HAR_002 = JSON.stringify({
    log: {
        version: "1.2",
        creator: {name: "harbor-e2e", version: "0.3.0"},
        pages: [{startedDateTime: "2026-03-08T11:20:00.000Z", id: "page_1", title: "Sync history", pageTimings: {onLoad: 180}}],
        entries: [{
            pageref: "page_1",
            startedDateTime: "2026-03-08T11:20:00.120Z",
            time: 14,
            request: {method: "GET", url: "http://127.0.0.1:8080/api/history?limit=20", httpVersion: "HTTP/1.1",
                cookies: [], headers: [], queryString: [{name: "limit", value: "20"}], headersSize: -1, bodySize: 0},
            response: {status: 200, statusText: "OK", httpVersion: "HTTP/1.1", cookies: [],
                headers: [{name: "Content-Type", value: "application/json"}],
                content: {size: 2, mimeType: "application/json", text: "[]"}, redirectURL: "", headersSize: -1, bodySize: 2},
            cache: {},
            timings: {send: 0, wait: 13, receive: 1},
        }],
    },
}, null, 2) + "\n";

const LOG_002 = `2026-03-08T11:18:00Z round 3 · bun test api/
api/tests/history.test.ts:
(pass) history > pages by 20
(pass) history > keeps failed runs with their reason
(pass) history > an empty history is an empty list
api/tests/health.test.ts:
(pass) health > answers on loopback only

 4 pass
 0 fail
Ran 4 tests across 2 files.
`;

/** CRC-32 (IEEE), the PNG chunk checksum. */
function crc32(bytes: Uint8Array): number {
    let c = 0xffffffff;
    for (const b of bytes) {
        c ^= b;
        for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return (c ^ 0xffffffff) >>> 0;
}

/**
 * A 4 × 2 RGB PNG: a green band over a grey one, the KPI band as a thumbnail. Built byte by byte (a zlib stream with
 * one stored block, so no compressor version can change it): deterministic, under 100 bytes, no image copied.
 */
function kpiBandPng(): Uint8Array {
    const width = 4, height = 2;
    const rows = [[0x2e, 0x9e, 0x5b], [0xd9, 0xdc, 0xe1]];
    const raw: number[] = [];
    for (let y = 0; y < height; y++) raw.push(0, ...Array.from({length: width}, () => nth(rows, y)).flat());
    let a = 1, b = 0;
    for (const x of raw) { a = (a + x) % 65521; b = (b + a) % 65521; }
    const n = raw.length;
    const zlib = [0x78, 0x01, 0x01, n & 0xff, n >> 8, ~n & 0xff, (~n >> 8) & 0xff, ...raw, b >> 8, b & 0xff, a >> 8, a & 0xff];
    const u32 = (v: number) => [v >>> 24, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];
    const chunk = (type: string, data: number[]) => {
        const body = new Uint8Array(Array.from(type, (ch) => ch.charCodeAt(0)).concat(data));
        return [...u32(data.length), ...body, ...u32(crc32(body))];
    };
    return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        ...chunk("IHDR", [...u32(width), ...u32(height), 8, 2, 0, 0, 0]),
        ...chunk("IDAT", zlib),
        ...chunk("IEND", [])]);
}

// ── repo-level files ───────────────────────────────────────────────────────────────────────────────────

const CONSTITUTION = `---
repo: harbor
derived: 2026-03-02T08:00:00Z
standards_version: 1.0.0
design_track: app
viewports: [390, 820, 1440]
dev_services: 4200=Web dev, 8080=API
stack: [bun, typescript, angular]
---

# Constitution — harbor

> Derived on 2026-03-02 from the sources listed below. The rules live in those sources; this file says which of them
> bind spec work, where to read them, and what proves them.

## Binding sources

| Source | Kind | Governs |
|--------|------|---------|
| \`CLAUDE.md\` (root and nested) | repo | lanes, the loopback rule, redaction |
| \`ISA.md\` § Principles, § Constraints | repo | atomic push, registry as the truth, no credential in any output |

## Non-negotiables

Every rule in the binding sources applies, except what stands under \`## Adaptations\`.

| Rule | Source | Verdict | Probe |
|------|--------|---------|-------|
| XC-01 bun, never npm | repo \`CLAUDE.md\` | binding | \`bun run check:static\` |
| XC-10 nothing individual in a committed file | repo \`CLAUDE.md\` | binding | \`bun run check:leak\` |

## Gates

| Tier | Command | Runs when |
|------|---------|-----------|
| static | \`bun run check:static\` | before every claim closes |
| quick | \`bun run verify:quick\` | at every implementation stop |
| full | \`bun run verify\` | before a spec is marked complete |

## Lanes

| Lane | Path prefixes | Context a worker loads | Lane probe |
|------|---------------|------------------------|------------|
| cli | \`cli/\` | \`cli/CLAUDE.md\` | \`bun test cli/\` |
| api | \`api/\`, \`tests/\` | \`api/CLAUDE.md\` | \`bun test api/\` |
| web | \`web/\` | \`web/CLAUDE.md\` | \`bun run --cwd web test\` |

## How specs are held to it

Every new spec is read against \`## Non-negotiables\` before its claims are minted. A plan that departs from a binding
row names the rule in \`## Stack Decisions\` with the reason.
`;

const TLDR = `---
generated: 2026-03-07T18:00:00Z
---

# TL;DR — harbor

<!-- section: overview -->
Sync is done and archived (001). The console (002) is in its last round with five claims open, retention (004) has
every claim closed and waits for its code review, and three specs opened this week are still being scoped.

<!-- section: try -->
Run \`harbor sync --dry-run\` against the sample config, then open the console on port 4200 and walk the sync history.

<!-- section: per-spec -->
- **002** Web console: 25 of 30 closed; one question open about the empty state.
- **003** Config loader rewrite: claims written, tasks not yet.
- **004** Retention policies: all 30 closed; the plan still lacks its diagram.
- **005** Config format choice: two fog lines to resolve before the decision.

<!-- section: risks -->
The config loader rewrite touches every package at once; its parity snapshots are the only guard.

<!-- section: next -->
Answer the empty-state question in 002, then run the code review for 004.
`;

// ── main ───────────────────────────────────────────────────────────────────────────────────────────────

function generate() {
    rmSync(join(ROOT, "ISA.md"), {force: true});
    rmSync(join(ROOT, "specs"), {recursive: true, force: true});

    write("ISA.md", master());
    write("specs/constitution.md", CONSTITUTION);

    const goals: Record<string, string> = {};
    for (const d of SPECS) {
        const md = specMd(d);
        write(`specs/${d.dir}/spec.md`, md);
        const goal = /^## Goal\n\n([^\n]+(?:\n[^\n#][^\n]*)*)/m.exec(md)?.[1] ?? d.task;
        goals[d.slug] = goal;
        write(`specs/${d.dir}/context.md`, contextMd(d, goal));
    }

    // plans
    const lanePath = (lane: string, file: string) => `${lane}/src/${file}`;
    write(`specs/${S001.dir}/plan.md`, planMd({slug: S001.slug, type: "feature", status: "approved", updated: "2026-03-02", title: S001.title,
        approach: "Copy blobs first and the manifest last, keyed on digest, so an interrupted run leaves nothing half-written. The obvious tag-keyed copy would re-upload whenever an upstream tag moved.",
        mermaid: "flowchart LR\n    A[read config] --> B[resolve digests]\n    B --> C[copy missing blobs]\n    C --> D[push manifest]\n    D --> E[append history]",
        files: [["cli/src/sync.ts", "new: the sync command", "ISC-5"], ["cli/src/registry.ts", "new: registry client with retry", "ISC-14"]],
        risks: [["rate limits on the source", "one run", "429 in the log", "back off and resume"]]}));
    write(`specs/${S002.dir}/plan.md`, planMd({slug: S002.slug, type: "feature", status: "approved", updated: "2026-03-03", title: S002.title,
        approach: "Serve a static Angular build from the API and read everything through one history endpoint. A separate console server would be one more process to run and secure.",
        mermaid: "flowchart LR\n    subgraph api\n        H[history endpoint] --> S[static files]\n    end\n    subgraph web\n        L[registry list] --> V[repository view]\n    end\n    V --> H",
        files: [["api/src/history.ts", "new: history endpoint", "ISC-55"], ["web/src/app/", "new: the console", "ISC-51"]],
        risks: [["history file grows large", "console load time", "p95 over 300 ms", "paginate the endpoint"]]}));
    write(`specs/${S003.dir}/plan.md`, planMd({slug: S003.slug, type: "refactor", status: "draft", updated: "2026-03-06", title: S003.title,
        approach: "Snapshot the effective config for every case first, then move each package onto the shared loader one at a time. Rewriting all three at once would leave no working reference to compare against.",
        mermaid: null,
        files: [["cli/src/config.ts", "becomes the shared loader", "ISC-81"], ["api/src/config.ts", "removed; imports the shared loader", "ISC-83"]],
        risks: [["a package reads a key the snapshot never covered", "one package", "parity test gap", "grep for every key before the move"]]}));
    write(`specs/${S004.dir}/plan.md`, planMd({slug: S004.slug, type: "feature", status: "approved", updated: "2026-03-04", title: S004.title,
        approach: "Evaluate policies into a preview first and delete only from a confirmed preview. Deleting inline while evaluating would make the preview a guess.",
        mermaid: null,
        files: [["api/src/retention.ts", "new: policy evaluation and preview", "ISC-95"], ["web/src/app/retention/", "new: the preview view", "ISC-115"]],
        risks: [["a tag moves between preview and run", "one manifest", "digest mismatch at delete", "re-check references at delete time"]]}));

    // tasks
    const t001 = tasksFor(S001.claims, () => "cli", (c) => lanePath("cli", c.probe.type === "bash" ? "dry-run.ts" : "sync.ts"),
        (c) => `make ${c.id} pass: ${c.probe.check}`);
    write(`specs/${S001.dir}/tasks.md`, tasksMd(S001.slug, S001.title, "2026-03-05T15:00:00Z", t001));
    const t002 = tasks002();
    write(`specs/${S002.dir}/tasks.md`, tasksMd(S002.slug, S002.title, "2026-03-08T16:45:00Z", t002.after));
    const t004 = tasksFor(S004.claims, (c) => (c.probe.type === "e2e" ? "web" : "api"),
        (c) => c.probe.type === "e2e" ? "web/src/app/retention/" : "api/src/retention.ts",
        (c) => `${c.probe.check} (${c.id})`);
    write(`specs/${S004.dir}/tasks.md`, tasksMd(S004.slug, S004.title, "2026-03-08T12:00:00Z", t004));

    write(`specs/${S002.dir}/rounds.jsonl`, rounds002(t002));
    write(".spectant/activity.jsonl", ACTIVITY_002);
    for (const [name, text] of Object.entries(ARTIFACTS_002)) write(`specs/${S002.dir}/artifacts/${name}`, text);
    writeBytes(`specs/${S002.dir}/.evidence/kpi-band-390.png`, kpiBandPng());
    write(`specs/${S002.dir}/.evidence/dashboard.har`, HAR_002);
    write(`specs/${S002.dir}/.evidence/bun-test-r3.log`, LOG_002);

    write(`specs/${S001.dir}/events.jsonl`, EVENTS_001);

    // gate marks — after every spec, plan and tasks file is written, since the reviewed digest covers them
    const g = (d: SpecDef, name: string, body: string) => write(`specs/${d.dir}/.gates/${name}.json`, body);
    g(S001, "reviewed", reviewedMark(join(ROOT, "specs", S001.dir), "2026-03-02T11:00:00Z"));
    g(S001, "code-reviewed", codeReviewedMark("harbor 001", "2026-03-05T14:30:00Z", "feature/001-manifest-sync", "clean"));
    g(S002, "reviewed", reviewedMark(join(ROOT, "specs", S002.dir), "2026-03-07T15:30:00Z")); // renewed after the re-cut
    g(S004, "reviewed", reviewedMark(join(ROOT, "specs", S004.dir), "2026-03-04T10:00:00Z"));
    g(S004, "code-reviewed", codeReviewedMark("harbor 004", "2026-03-08T11:00:00Z", "feature/004-retention-policies", "one finding fixed; tree changed since"));
    g(S006, "reviewed", staleReviewedMark("harbor 006", "2026-03-08T12:00:00Z"));

    write("specs/tldr.md", TLDR);
}

// ── cli ────────────────────────────────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
if (argv[0] === "--mark-reviewed") {
    const dir = argv[1], at = argv[2];
    if (!dir || !at) { console.error("usage: generate.ts --mark-reviewed <spec-dir> <ISO time>"); process.exit(1); }
    mkdirSync(join(dir, ".gates"), {recursive: true});
    writeFileSync(join(dir, ".gates", "reviewed.json"), reviewedMark(dir, at));
    console.log(`reviewed mark written for ${dir}`);
} else if (argv.length) {
    console.error("usage: bun core/fixtures/harbor/generate.ts [--mark-reviewed <spec-dir> <ISO time>]");
    process.exit(1);
} else {
    generate();
    console.log(`harbor fixture: ${written.length} files, master progress ${progress(ALL)}`);
}
