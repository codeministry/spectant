// The writes contract (T67, ISC-24 to ISC-27, ISC-86): the two POST routes, their bodies with the client's sha256,
// the 200 / 400 / 409 / 423 answers as one exhaustive union, the reviewed mark in the old skill's format, the one
// `review → build` event line, and the lock that answers 423. Nothing here writes a file.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseActor } from "../core/src/actor.ts";
import { validateEventLine } from "../core/src/events.ts";
import { FILE_KINDS, type ClaimLock } from "../core/src/files.ts";
import { REVIEWED_FILES, hashForGate, readGateMark } from "../core/src/gates.ts";
import {
  API_ERRORS,
  PENDING_ROUTE_TABLE,
  REVIEWED_HASHES_HEADER,
  SPEC_HASH_HEADER,
  SPEC_ROUTE_TABLE,
  TASKS_HASH_HEADER,
  formatReviewedHashes,
  matchSpecRoute,
  specRoutes,
  type ReviewedHashes,
} from "../server/src/spec-routes.contract.ts";
import {
  EVENTS_PATH,
  NO_AGENT_SOURCE,
  REVIEWED_EVENT,
  REVIEWED_MARK_PATH,
  VIEWER_ACTOR_FALLBACK,
  WRITE_ACTOR,
  WRITE_ERRORS,
  WRITE_HASH_HEADER,
  WRITE_OPERATIONS,
  WRITE_PATHS,
  WRITE_ROUTES,
  WRITE_STATUSES,
  WRITE_TABLE,
  ideaConflict,
  specConflict,
  writePathsOf,
  type WriteOperation,
  blockingLock,
  eventAppendBytes,
  gateConflict,
  gateReviewedRequestFromHeader,
  hasAgentSource,
  parseWriteBody,
  reviewedEvent,
  reviewedEventCommand,
  reviewedMarkText,
  staleFiles,
  taskCheckRequest,
  tasksConflict,
  writeAnswerOf,
  writeRoutes,
  type WriteAnswer,
  type WriteRoute,
} from "../server/src/writes.contract.ts";

const ROOT = resolve(import.meta.dir, "..");
const CONTRACT = join(ROOT, "server", "src", "writes.contract.ts");
const HEX_A = hashForGate("spec.md", "# a\n");
const HEX_B = hashForGate("plan.md", "# b\n");
const HEX_C = hashForGate("tasks.md", "- [ ] T1 · ISC-1 · core — c\n");
const HASHES: ReviewedHashes = { spec: HEX_A, plan: HEX_B, tasks: HEX_C };
const TS = "2026-09-29T10:00:00.000Z";
const lock = (source: ClaimLock["source"], claim: string, session = `s-${claim}`): ClaimLock => ({ source, claim, session, actor: parseActor(session), since: TS });

describe("routes", () => {
  test("the write routes are the table's two POST routes; every builder round-trips as POST only", () => {
    expect<readonly string[]>([...WRITE_ROUTES]).toEqual(SPEC_ROUTE_TABLE.filter((e) => e.method === "POST").map((e) => e.route));
    expect(writeRoutes.gateReviewed("harbor", "002")).toBe("/api/workspaces/harbor/specs/002/gate/reviewed");
    expect(writeRoutes.taskCheck("harbor", "002", "T12")).toBe("/api/workspaces/harbor/specs/002/tasks/T12/check");
    expect(writeRoutes.gateReviewed("a b", "002")).toBe(specRoutes.gateReviewed("a b", "002"));
    expect(matchSpecRoute(writeRoutes.gateReviewed("a b", "002"), "POST")).toEqual({ route: "gateReviewed", params: { ws: "a b", id: "002" } });
    expect(matchSpecRoute(writeRoutes.taskCheck("w", "002", "T/1"), "POST")).toEqual({
      route: "taskCheck",
      params: { ws: "w", id: "002", tid: "T/1" },
    });
    expect(matchSpecRoute(writeRoutes.taskCheck("w", "002", "T1"), "GET")).toBeNull();
  });

  test("every write status the union answers is in the table's statuses", () => {
    for (const route of WRITE_ROUTES) {
      const entry = SPEC_ROUTE_TABLE.find((e) => e.route === route);
      for (const status of WRITE_STATUSES) expect(entry?.statuses).toContain(status);
    }
  });

  test("the write targets are core's file kinds", () => {
    expect(REVIEWED_MARK_PATH).toBe(FILE_KINDS.gateReviewed.path);
    expect(EVENTS_PATH).toBe(FILE_KINDS.events.path);
  });
});

describe("request bodies", () => {
  test("the header round-trips into the gate body the validator accepts", () => {
    expect(WRITE_HASH_HEADER).toEqual({ gateReviewed: REVIEWED_HASHES_HEADER, taskCheck: TASKS_HASH_HEADER });
    const header = formatReviewedHashes({ ...HASHES, tasks: null });
    const body = gateReviewedRequestFromHeader(header);
    expect(body).toEqual({ hashes: { ...HASHES, tasks: null } });
    expect(parseWriteBody("gateReviewed", JSON.stringify(body))).toEqual({ ok: true, body: { hashes: { ...HASHES, tasks: null } } });
    expect(gateReviewedRequestFromHeader(null)).toBeNull();
    expect(gateReviewedRequestFromHeader("spec=-")).toBeNull();
  });

  test("the checkbox body carries the raw tasks.md hash and the wanted state", () => {
    expect(taskCheckRequest(HEX_C, true)).toEqual({ checked: true, hash: HEX_C });
    expect(parseWriteBody("taskCheck", JSON.stringify({ checked: false, hash: HEX_C }))).toEqual({ ok: true, body: { checked: false, hash: HEX_C } });
  });

  test("parseWriteBody rejects non-JSON, wrong shapes and extra-strict hashes with invalid-body", () => {
    const bad = { ok: false, error: { error: "invalid-body" } } as const;
    expect(parseWriteBody("gateReviewed", "not json")).toEqual(bad);
    expect(parseWriteBody("gateReviewed", "")).toEqual(bad);
    expect(parseWriteBody("gateReviewed", JSON.stringify({ hashes: { spec: HEX_A, plan: HEX_B } }))).toEqual(bad);
    expect(parseWriteBody("gateReviewed", JSON.stringify({ hashes: { ...HASHES, spec: HEX_A.toUpperCase() } }))).toEqual(bad);
    expect(parseWriteBody("taskCheck", JSON.stringify({ checked: "yes", hash: HEX_C }))).toEqual(bad);
    expect(parseWriteBody("taskCheck", JSON.stringify({ checked: true, hash: null }))).toEqual(bad);
    expect(parseWriteBody("taskCheck", JSON.stringify([true, HEX_C]))).toEqual(bad);
  });
});

describe("the reviewed mark and the event line", () => {
  test("the mark is the old skill's bytes and reads back through core with no diagnostic", () => {
    const text = reviewedMarkText(TS, { ...HASHES, plan: null });
    expect(text).toBe(
      `{\n  "gate": "reviewed",\n  "at": "${TS}",\n  "files": {\n    "spec.md": "${HEX_A}",\n    "plan.md": null,\n    "tasks.md": "${HEX_C}"\n  }\n}\n`,
    );
    const reading = readGateMark("reviewed", text);
    expect(reading.diagnostics).toEqual([]);
    expect(reading.mark).toEqual({ gate: "reviewed", at: TS, files: { "spec.md": HEX_A, "plan.md": null, "tasks.md": HEX_C } });
    expect(Object.keys((JSON.parse(text) as { files: Record<string, unknown> }).files)).toEqual([...REVIEWED_FILES]);
  });

  test("one review → build line, actor app, that validateEventLine accepts without warnings", () => {
    expect(REVIEWED_EVENT).toEqual({ from: "review", to: "build" });
    expect(WRITE_ACTOR).toBe("app");
    const event = reviewedEvent(TS, "002");
    expect(event).toEqual({ ts: TS, from: "review", to: "build", command: reviewedEventCommand("002"), actor: "app" });
    const line = JSON.stringify(event);
    expect(line).not.toContain("\n");
    const v = validateEventLine(line, 1);
    // The read side adds the parsed actor (spec 008, T61); `app` is outside the actor grammar, so it reads as legacy.
    expect(v).toEqual({ ok: true, event: { ...event, actorRef: parseActor("app") }, warnings: [] });
  });

  test("the appended bytes are exactly one line, a missing trailing newline repaired first", () => {
    const event = reviewedEvent(TS, "002");
    const line = JSON.stringify(event);
    expect(eventAppendBytes("", event)).toBe(`${line}\n`);
    expect(eventAppendBytes('{"a":1}\n', event)).toBe(`${line}\n`);
    expect(eventAppendBytes('{"a":1}', event)).toBe(`\n${line}\n`);
    expect(eventAppendBytes(null, event)).toBe(`${line}\n`);
    expect(eventAppendBytes("", event).split("\n").filter((l) => l !== "")).toHaveLength(1);
  });
});

describe("409 and 423", () => {
  test("staleFiles names every file whose hash differs, in REVIEWED_FILES order", () => {
    expect(staleFiles(HASHES, HASHES)).toEqual([]);
    expect(staleFiles(HASHES, { ...HASHES, tasks: null, spec: HEX_B })).toEqual(["spec.md", "tasks.md"]);
  });

  test("the gate conflict carries the stale files and the current hashes; none when equal", () => {
    expect(gateConflict(HASHES, HASHES)).toBeNull();
    const now = { ...HASHES, plan: HEX_A };
    expect(gateConflict(HASHES, now)).toEqual({ error: "hash-mismatch", files: ["plan.md"], expected: now });
  });

  test("the checkbox conflict names tasks.md and its current raw hash", () => {
    expect(tasksConflict(HEX_C, HEX_C)).toBeNull();
    expect(tasksConflict(HEX_C, HEX_A)).toEqual({ error: "hash-mismatch", files: ["tasks.md"], expected: { tasks: HEX_A } });
  });

  test("blockingLock: any lock on the spec blocks; the task's own claim first, then frontier over activity", () => {
    expect(blockingLock([], "ISC-3")).toBeNull();
    const a1 = lock("activity", "ISC-1");
    const f2 = lock("frontier", "ISC-2");
    const a3 = lock("activity", "ISC-3");
    expect(blockingLock([a1, f2], null)).toEqual({ error: "locked", lock: f2 });
    expect(blockingLock([a1, a3], null)).toEqual({ error: "locked", lock: a1 });
    expect(blockingLock([a1, f2, a3], "ISC-3")).toEqual({ error: "locked", lock: a3 });
    expect(blockingLock([a1, a3, lock("frontier", "ISC-3")], "ISC-3")?.lock.source).toBe("frontier");
    expect(blockingLock([a1], "ISC-9")).toEqual({ error: "locked", lock: a1 });
  });

  test("no agent source: lockSource none, the page's words, and the write proceeds", () => {
    expect(NO_AGENT_SOURCE).toBe("no agent source");
    expect(hasAgentSource("none")).toBe(false);
    expect(hasAgentSource("activity")).toBe(true);
    expect(hasAgentSource("frontier")).toBe(true);
  });
});

describe("answers", () => {
  function describeAnswer(answer: WriteAnswer<WriteRoute>): string {
    // Exhaustive: a new status in the union fails this switch at compile time (no default).
    switch (answer.status) {
      case 200:
        return `ok ${answer.body.lockSource}`;
      case 400:
        return answer.body.error;
      case 409:
        return `${answer.body.error} ${answer.body.files.join(",")}`;
      case 423:
        return `${answer.body.error} ${answer.body.lock.session}`;
    }
  }

  test("writeAnswerOf types each valid body by status and refuses what does not fit", () => {
    const event = reviewedEvent(TS, "002");
    const gateOk = { at: TS, hashes: HASHES, lockSource: "none" as const, event };
    const a = writeAnswerOf("gateReviewed", 200, gateOk);
    expect(a).toEqual({ status: 200, body: gateOk });
    expect(a && describeAnswer(a)).toBe("ok none");
    expect(writeAnswerOf("gateReviewed", 200, { ...gateOk, event: { ...event, to: "nowhere" } })).toBeNull();
    expect(writeAnswerOf("gateReviewed", 200, { ...gateOk, lockSource: "maybe" })).toBeNull();

    const checkOk = { task: "T1", checked: true, hash: HEX_A, lockSource: "frontier" as const, line: { number: 4, text: "- [x] T1 · ISC-1 · core — c" } };
    expect(writeAnswerOf("taskCheck", 200, checkOk)).toEqual({ status: 200, body: checkOk });
    expect(writeAnswerOf("taskCheck", 200, { ...checkOk, line: { number: 0, text: "x" } })).toBeNull();

    const stale = gateConflict(HASHES, { ...HASHES, spec: null });
    if (stale === null) throw new Error("expected a conflict");
    expect(writeAnswerOf("gateReviewed", 409, stale)).toEqual({ status: 409, body: stale });
    expect(describeAnswer(writeAnswerOf("gateReviewed", 409, stale) as WriteAnswer<WriteRoute>)).toBe("hash-mismatch spec.md");
    expect(writeAnswerOf("taskCheck", 409, tasksConflict(HEX_C, HEX_A))).not.toBeNull();
    expect(writeAnswerOf("taskCheck", 409, stale)).toBeNull();

    const locked = blockingLock([lock("frontier", "ISC-2", "round-11")], null);
    expect(describeAnswer(writeAnswerOf("taskCheck", 423, locked) as WriteAnswer<WriteRoute>)).toBe("locked round-11");
    expect(writeAnswerOf("taskCheck", 423, { error: "locked", lock: { source: "none", claim: "ISC-2", session: "x", since: TS } })).toBeNull();

    expect(writeAnswerOf("gateReviewed", 400, { error: "invalid-body" })).toEqual({ status: 400, body: { error: "invalid-body" } });
    expect(writeAnswerOf("gateReviewed", 404, { error: "not-found" })).toBeNull();
  });
});

describe("error codes", () => {
  test("the write errors are kebab-case and listed in API_ERRORS", () => {
    for (const code of WRITE_ERRORS) {
      expect(code).toMatch(/^[a-z]+(?:-[a-z]+)*$/);
      expect(API_ERRORS as readonly string[]).toContain(code);
    }
    expect([...WRITE_ERRORS]).toEqual(["invalid-body", "hash-mismatch", "locked"]);
  });
});

describe("the four app writes (spec 008, T81): the table, the paths each may touch, the 409 and 423 forms", () => {
  test("the table holds the four operations in order; the registered ones are exactly WRITE_ROUTES", () => {
    expect([...WRITE_OPERATIONS]).toEqual(["gateReviewed", "taskCheck", "transition", "allocate"]);
    expect(Object.keys(WRITE_TABLE)).toEqual([...WRITE_OPERATIONS]);
    expect(WRITE_OPERATIONS.filter((op) => WRITE_TABLE[op].registered)).toEqual([...WRITE_ROUTES]);
    const pending = PENDING_ROUTE_TABLE.filter((e) => e.methods.includes("POST")).map((e): string => e.route);
    expect<readonly string[]>(WRITE_OPERATIONS.filter((op) => !WRITE_TABLE[op].registered)).toEqual(pending);
  });

  test("each write's hash source, hash form, 409, 422 and 423 forms", () => {
    const rows = WRITE_OPERATIONS.map((op) => {
      const e = WRITE_TABLE[op];
      return [op, e.hashFrom, e.hash, e.conflict, e.refused, e.locked];
    });
    expect(rows).toEqual([
      ["gateReviewed", REVIEWED_HASHES_HEADER, "normalised", "StaleGate", null, "Locked"],
      ["taskCheck", TASKS_HASH_HEADER, "raw", "StaleTasks", null, "Locked"],
      ["transition", SPEC_HASH_HEADER, "raw", "StaleSpec", "TransitionRefused", "Locked"],
      ["allocate", "IdeaPage.hash", "raw", "StaleIdea", "AllocateRefused", "Locked"],
    ]);
    // A refusable write lists 422 on its route; the others do not.
    for (const op of WRITE_OPERATIONS) {
      const statuses = [...SPEC_ROUTE_TABLE, ...PENDING_ROUTE_TABLE].find((e) => e.route === op)?.statuses ?? [];
      for (const status of [200, 400, 403, 404, 405, 409, 423]) expect({ op, status, listed: statuses.includes(status) }).toEqual({ op, status, listed: true });
      expect({ op, refusable: statuses.includes(422) }).toEqual({ op, refusable: WRITE_TABLE[op].refused !== null });
    }
  });

  test("WRITE_PATHS names exactly the files each write may touch, built from core's file kinds", () => {
    const folder = (kind: keyof typeof FILE_KINDS): string => `specs/NNN-slug/${FILE_KINDS[kind].path}`;
    expect(WRITE_PATHS).toEqual({
      gateReviewed: { writes: [folder("gateReviewed"), folder("events")], removes: [], creates: "specs/NNN-slug/.gates/" },
      taskCheck: { writes: [folder("tasks")], removes: [], creates: null },
      transition: { writes: [folder("spec"), folder("events")], removes: [], creates: null },
      allocate: { writes: [folder("context"), folder("spec"), folder("events")], removes: [`${FILE_KINDS.idea.repoPath ?? ""}<slug>.md`], creates: "specs/NNN-slug/" },
    });
    expect(Object.keys(WRITE_PATHS)).toEqual([...WRITE_OPERATIONS]);
    expect(WRITE_PATHS.gateReviewed.writes[0].startsWith(WRITE_PATHS.gateReviewed.creates)).toBe(true);
    // The existing two writes keep the targets the routes already write.
    expect(WRITE_PATHS.gateReviewed.writes).toEqual([`specs/NNN-slug/${REVIEWED_MARK_PATH}`, `specs/NNN-slug/${EVENTS_PATH}`]);
  });

  test("writePathsOf fills the folder and the story slug; nothing else changes", () => {
    expect(writePathsOf("transition", "002-web-console")).toEqual({
      writes: ["specs/002-web-console/spec.md", "specs/002-web-console/events.jsonl"],
      removes: [],
      creates: null,
    });
    expect(writePathsOf("allocate", "007-tide-tables", "tide-tables")).toEqual({
      writes: ["specs/007-tide-tables/context.md", "specs/007-tide-tables/spec.md", "specs/007-tide-tables/events.jsonl"],
      removes: ["specs/ideas/tide-tables.md"],
      creates: "specs/007-tide-tables/",
    });
    expect(writePathsOf("gateReviewed", "002-web-console").creates).toBe("specs/002-web-console/.gates/");
    for (const op of WRITE_OPERATIONS) {
      const all = Object.values(writePathsOf(op, "001-x", "s")).flat().filter((p): p is string => typeof p === "string");
      expect(all.filter((p) => p.includes("NNN-slug") || p.includes("<slug>"))).toEqual([]);
    }
  });

  test("the spec and story conflicts name their file and its raw hash now; none when equal", () => {
    const hex = hashForGate("spec.md", "# a\n");
    const other = hashForGate("spec.md", "# b\n");
    expect(specConflict(hex, hex)).toBeNull();
    expect(specConflict(hex, other)).toEqual({ error: "hash-mismatch", files: ["spec.md"], expected: { spec: other } });
    expect(ideaConflict("specs/ideas/tide-tables.md", hex, hex)).toBeNull();
    expect(ideaConflict("specs/ideas/tide-tables.md", hex, other)).toEqual({
      error: "hash-mismatch",
      files: ["specs/ideas/tide-tables.md"],
      expected: { idea: other },
    });
  });

  test("the viewer's fallback actor is an agent id of the grammar, not a legacy value like WRITE_ACTOR", () => {
    expect(VIEWER_ACTOR_FALLBACK).toBe("a:spectant:app");
    expect(parseActor(VIEWER_ACTOR_FALLBACK)).toMatchObject({ kind: "agent", legacy: false });
    expect(parseActor(WRITE_ACTOR).legacy).toBe(true);
  });

  test("WriteOperation covers the table at compile time", () => {
    const ops: Record<WriteOperation, true> = { gateReviewed: true, taskCheck: true, transition: true, allocate: true };
    expect(Object.keys(ops)).toEqual([...WRITE_OPERATIONS]);
  });
});

describe("the writes contract is browser-safe", () => {
  function reach(file: string, seen = new Set<string>()): Set<string> {
    if (seen.has(file)) return seen;
    seen.add(file);
    const source = readFileSync(file, "utf8");
    for (const m of source.matchAll(/^\s*(?:import|export)\s+(?!type\b)[^;]*?\bfrom\s+['"](\.[^'"]+)['"]/gm)) {
      reach(resolve(dirname(file), m[1] ?? ""), seen);
    }
    return seen;
  }

  test("no module reached from the writes contract imports Bun or Node", () => {
    const files = [...reach(CONTRACT)];
    expect(files.map((f) => f.slice(ROOT.length + 1)).sort()).toEqual([
      "core/src/actor.ts",
      "core/src/events.ts",
      "core/src/files.ts",
      "server/src/assets.contract.ts",
      "server/src/spec-routes.contract.ts",
      "server/src/writes.contract.ts",
    ]);
    const offending = files.filter((file) => {
      const source = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      return /\bBun\.|\bprocess\.|\brequire\(|(?:from|import)\s*\(?\s*['"](?:node:|bun|fs|path|os|child_process)/.test(source);
    });
    expect(offending).toEqual([]);
  });
});
