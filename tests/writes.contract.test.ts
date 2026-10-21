// The writes contract (T67, ISC-24 to ISC-27, ISC-86): the two POST routes, their bodies with the client's sha256,
// the 200 / 400 / 409 / 423 answers as one exhaustive union, the reviewed mark in the old skill's format, the one
// `review → build` event line, and the lock that answers 423. Nothing here writes a file.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseActor } from "../core/src/actor.ts";
import { validateEventLine } from "../core/src/events.ts";
import { FILE_KINDS, type ClaimLock } from "../core/src/files.ts";
import { TOKENS_PATH } from "../server/src/tokens-cli.ts";
import {
  REVIEWED_FILES,
  hashForGate,
  readGateMark,
  type ReviewedFile as GateReviewedFile,
  type ReviewedMark as GateReviewedMark,
} from "../core/src/gates.ts";
import {
  ACTIVITY_HASH_HEADER,
  API_ERRORS,
  REVIEWED_HASHES_HEADER,
  SPEC_HASH_HEADER,
  SPEC_ROUTE_TABLE,
  TASKS_HASH_HEADER,
  WORKSPACE_ROUTE_TABLE,
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
  ACTIVITY_PATH,
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
  writeActorOf,
  writeAnswerOf,
  writeRoutes,
  type ReviewedFile as ContractReviewedFile,
  type ReviewedMark as ContractReviewedMark,
  type WriteAnswer,
  type WriteRoute,
} from "../server/src/writes.contract.ts";

/** A synthetic viewer id of the actor grammar (`u:` + eight hex digits); no real address behind it. */
const VIEWER = "u:3f9c0a7d";

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
    expect(WRITE_HASH_HEADER).toEqual({ gateReviewed: REVIEWED_HASHES_HEADER, taskCheck: TASKS_HASH_HEADER, transition: SPEC_HASH_HEADER });
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

  test("one review → build line, actor the viewer (T80), that validateEventLine accepts without warnings", () => {
    expect(REVIEWED_EVENT).toEqual({ from: "review", to: "build" });
    const event = reviewedEvent(TS, "002", VIEWER);
    expect(event).toEqual({ ts: TS, from: "review", to: "build", command: reviewedEventCommand("002"), actor: VIEWER });
    const line = JSON.stringify(event);
    expect(line).not.toContain("\n");
    const v = validateEventLine(line, 1);
    // The read side adds the parsed actor (spec 008, T61); the viewer's `u:` id is a person of the grammar.
    expect(v).toEqual({ ok: true, event: { ...event, actorRef: parseActor(VIEWER) }, warnings: [] });
    expect(parseActor(VIEWER)).toMatchObject({ kind: "person", legacy: false });
  });

  test("writeActorOf: the viewer's u: id when configured, else the fallback agent id; never the legacy `app`", () => {
    expect(writeActorOf(VIEWER)).toBe(VIEWER);
    expect(writeActorOf(null)).toBe(VIEWER_ACTOR_FALLBACK);
    expect(reviewedEvent(TS, "002", writeActorOf(null)).actor).toBe("a:spectant:app");
    expect(WRITE_ACTOR).toBe("app");
    expect(parseActor(writeActorOf(null)).legacy).toBe(false);
  });

  test("the appended bytes are exactly one line, a missing trailing newline repaired first", () => {
    const event = reviewedEvent(TS, "002", VIEWER);
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
      case 422:
        return `${answer.body.error} ${answer.body.reason}`;
      case 423:
        return `${answer.body.error} ${answer.body.lock.session}`;
    }
  }

  test("writeAnswerOf types each valid body by status and refuses what does not fit", () => {
    const event = reviewedEvent(TS, "002", VIEWER);
    const gateOk = { at: TS, hashes: HASHES, lockSource: "none" as const, event };
    const a = writeAnswerOf("gateReviewed", 200, gateOk);
    expect(a).toEqual({ status: 200, body: gateOk });
    expect(a && describeAnswer(a)).toBe("ok none");
    const fallback = { ...gateOk, event: reviewedEvent(TS, "002", VIEWER_ACTOR_FALLBACK) };
    expect(writeAnswerOf("gateReviewed", 200, fallback)).toEqual({ status: 200, body: fallback });
    // The legacy `app` no longer fits a 200: every app write records an actor of the grammar (T80).
    expect(writeAnswerOf("gateReviewed", 200, { ...gateOk, event: { ...event, actor: WRITE_ACTOR } })).toBeNull();
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

  test("the transition (T83): its body parses, and its 200, 409 and 422 fit; a 422 fits no other write", () => {
    expect(parseWriteBody("transition", JSON.stringify({ to: "review", hash: HEX_A }))).toEqual({ ok: true, body: { to: "review", hash: HEX_A } });
    expect(parseWriteBody("transition", JSON.stringify({ to: "shipping", hash: HEX_A }))).toEqual({ ok: false, error: { error: "invalid-body" } });
    expect(parseWriteBody("transition", "{")).toEqual({ ok: false, error: { error: "invalid-body" } });

    const event = { ts: TS, from: "tasks", to: "review", command: "spectant move 003 review", actor: VIEWER } as const;
    const ok = { from: "tasks", to: "review", hash: HEX_B, event, lockSource: "activity" } as const;
    expect(writeAnswerOf("transition", 200, ok)).toEqual({ status: 200, body: ok });
    expect(writeAnswerOf("transition", 200, { ...ok, to: "build" })).toBeNull();
    expect(writeAnswerOf("transition", 200, { ...ok, event: { ...event, actor: WRITE_ACTOR } })).toBeNull();

    const stale = specConflict(HEX_A, HEX_B);
    if (stale === null) throw new Error("expected a conflict");
    expect(writeAnswerOf("transition", 409, stale)).toEqual({ status: 409, body: stale });
    expect(writeAnswerOf("transition", 409, tasksConflict(HEX_C, HEX_A))).toBeNull();

    const refused = { error: "transition-refused", reason: "build needs a fresh reviewed mark", command: "/spec review 005" };
    const answer = writeAnswerOf("transition", 422, refused);
    expect(answer && describeAnswer(answer)).toBe("transition-refused build needs a fresh reviewed mark");
    expect(writeAnswerOf("transition", 422, { ...refused, command: null })).not.toBeNull();
    expect(writeAnswerOf("taskCheck", 422, refused)).toBeNull();
  });

  test("the allocation (T111): its 200, 409, 422 and 423 fit writeAnswerOf; a body of another write does not", () => {
    const paths = writePathsOf("allocate", "007-tide-tables", "tide-tables");
    const ok = { id: "007", folder: "specs/007-tide-tables/", files: paths.writes, removed: "specs/ideas/tide-tables.md", lockSource: "none" } as const;
    expect(paths.removes).toEqual([ok.removed]);
    expect(writeAnswerOf("allocate", 200, ok)).toEqual({ status: 200, body: ok });
    expect(writeAnswerOf("allocate", 200, { ...ok, id: "008" })).toBeNull();
    expect(writeAnswerOf("allocate", 200, { ...ok, files: paths.writes.slice(1) })).toBeNull();
    expect(writeAnswerOf("allocate", 200, { ...ok, removed: "specs/ideas/a/b.md" })).toBeNull();
    expect(writeAnswerOf("allocate", 200, { ...ok, lockSource: "maybe" })).toBeNull();
    expect(writeAnswerOf("transition", 200, ok)).toBeNull();

    const stale = ideaConflict("specs/ideas/tide-tables.md", HEX_A, HEX_B);
    if (stale === null) throw new Error("expected a conflict");
    expect(writeAnswerOf("allocate", 409, stale)).toEqual({ status: 409, body: stale });
    expect(writeAnswerOf("allocate", 409, specConflict(HEX_A, HEX_B))).toBeNull();
    expect(writeAnswerOf("transition", 409, stale)).toBeNull();

    for (const reason of ["folder-exists", "not-in-index"] as const) {
      const refused = { error: "allocate-refused", reason, folder: "specs/007-tide-tables/" } as const;
      expect(writeAnswerOf("allocate", 422, refused)).toEqual({ status: 422, body: refused });
      expect(writeAnswerOf("transition", 422, refused)).toBeNull();
    }
    expect(writeAnswerOf("allocate", 422, { error: "allocate-refused", reason: "folder-exists", folder: null })).not.toBeNull();
    expect(writeAnswerOf("allocate", 422, { error: "allocate-refused", reason: "other", folder: null })).toBeNull();
    expect(writeAnswerOf("allocate", 423, blockingLock([lock("activity", "ISC-1")], null))).not.toBeNull();
    expect(writeAnswerOf("allocate", 400, { error: "invalid-body" })).not.toBeNull();
  });
});

describe("error codes", () => {
  test("the write errors are kebab-case and listed in API_ERRORS", () => {
    for (const code of WRITE_ERRORS) {
      expect(code).toMatch(/^[a-z]+(?:-[a-z]+)*$/);
      expect(API_ERRORS as readonly string[]).toContain(code);
    }
    expect([...WRITE_ERRORS]).toEqual(["invalid-body", "hash-mismatch", "locked", "run-locked"]);
  });
});

describe("the five app writes (spec 008, T81; spec 036): the table, the paths each may touch, the 409 and 423 forms", () => {
  test("the table holds the five operations in order; the registered ones are WRITE_ROUTES, the allocation and the backlog", () => {
    expect([...WRITE_OPERATIONS]).toEqual(["gateReviewed", "taskCheck", "transition", "allocate", "backlog", "runRelease"]);
    expect(Object.keys(WRITE_TABLE)).toEqual([...WRITE_OPERATIONS]);
    // Widened to boolean: every entry is registered since the allocation landed (T87), so the literal types agree.
    const registered = (op: WriteOperation): boolean => WRITE_TABLE[op].registered;
    expect(WRITE_OPERATIONS.filter(registered)).toEqual([...WRITE_ROUTES, "allocate", "backlog", "runRelease"]);
    expect(WORKSPACE_ROUTE_TABLE.filter((e) => e.method === "POST").map((e): string => e.route)).toEqual(["allocate", "backlog", "runRelease"]);
    expect<readonly string[]>(WRITE_OPERATIONS.filter((op) => !registered(op))).toEqual([]);
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
      // Spec 036: the backlog reads no lock source, so it has no 423.
      ["backlog", "PlanningModel.backlogHash", "raw", "StaleBacklog", "BacklogRefused", null],
      // Spec 040 (ISC-226): the run release reads no claim lock and no run locks it, so it has no 423 either.
      ["runRelease", ACTIVITY_HASH_HEADER, "raw", "StaleActivity", "RunReleaseRefused", null],
    ]);
    // Spec 040 (ISC-225): every write on a spec or a story has the run lock's 423 beside the claim lock's; the backlog none.
    expect(WRITE_OPERATIONS.map((op) => [op, WRITE_TABLE[op].runLocked])).toEqual([
      ["gateReviewed", "RunLocked"],
      ["taskCheck", "RunLocked"],
      ["transition", "RunLocked"],
      ["allocate", "RunLocked"],
      ["backlog", null],
      ["runRelease", null],
    ]);
    // A refusable write lists 422 on its route; the others do not. A write without a 423 form lists no 423.
    for (const op of WRITE_OPERATIONS) {
      const statuses = [...SPEC_ROUTE_TABLE, ...WORKSPACE_ROUTE_TABLE].find((e) => e.route === op)?.statuses ?? [];
      for (const status of [200, 400, 403, 404, 405, 409]) expect({ op, status, listed: statuses.includes(status) }).toEqual({ op, status, listed: true });
      expect({ op, locks: statuses.includes(423) }).toEqual({ op, locks: WRITE_TABLE[op].locked !== null });
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
      codeReviewFeature: { writes: [folder("gateCodeReviewed"), folder("events")], removes: [], creates: "specs/NNN-slug/.gates/" },
      tokens: { writes: [FILE_KINDS.tokens.repoPath ?? ""], removes: [], creates: null },
      backlog: { writes: [FILE_KINDS.backlog.repoPath ?? "", FILE_KINDS.backlogEvents.repoPath ?? ""], removes: [], creates: null },
      runRelease: { writes: [".spectant/activity.jsonl"], removes: [], creates: null },
    });
    // The four app writes of spec 008, then the two CLI-only paths, each without a table row and without a route: the
    // fifth, the feature-level code-review mark (T93), and the sixth, the token measurement `spectant tokens --yes`
    // writes; then the seventh, the backlog route's (spec 036), and the eighth, the run release's (spec 040), each with a row.
    const routed = new Set<string>(["backlog", "runRelease"]);
    expect(Object.keys(WRITE_PATHS)).toEqual([...WRITE_OPERATIONS.filter((op) => !routed.has(op)), "codeReviewFeature", "tokens", "backlog", "runRelease"]);
    expect(WRITE_PATHS.runRelease.writes).toEqual([ACTIVITY_PATH]);
    expect(WRITE_PATHS.backlog.writes).toEqual(["specs/backlog.md", "specs/backlog.events.jsonl"]);
    expect(Object.keys(WRITE_TABLE)).not.toContain("codeReviewFeature");
    expect(Object.keys(WRITE_TABLE)).not.toContain("tokens");
    expect(WRITE_PATHS.tokens.writes).toEqual(["specs/tokens.jsonl"]);
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
    const ops: Record<WriteOperation, true> = { gateReviewed: true, taskCheck: true, transition: true, allocate: true, backlog: true, runRelease: true };
    expect(Object.keys(ops)).toEqual([...WRITE_OPERATIONS]);
  });
});

// T19 (ISC-137.1): the CLI writes the sixth path's file, and it takes the path from the constant, not a literal.
describe("the sixth write path is the one the CLI writes", () => {
  test("`spectant tokens` takes its path from WRITE_PATHS.tokens and names no literal of its own", () => {
    expect(TOKENS_PATH).toBe(WRITE_PATHS.tokens.writes[0]);
    const source = readFileSync(join(ROOT, "server", "src", "tokens-cli.ts"), "utf8");
    expect(source.includes("WRITE_PATHS.tokens")).toBe(true);
    expect(source.includes('"specs/tokens.jsonl"')).toBe(false);
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
      "core/src/spec-ref.ts",
      "server/src/contracts/assets.contract.ts",
      "server/src/contracts/spec-routes.contract.ts",
      "server/src/contracts/spec-routes/api-answers.ts",
      "server/src/contracts/spec-routes/app-state.ts",
      "server/src/contracts/spec-routes/live.ts",
      "server/src/contracts/spec-routes/prototype-route.ts",
      "server/src/contracts/spec-routes/route-match.ts",
      "server/src/contracts/spec-routes/spec-route-table.ts",
      "server/src/contracts/spec-routes/workspace-route-table.ts",
      "server/src/contracts/spec-routes/write-requests.ts",
      "server/src/spec-routes.contract.ts",
      "server/src/writes.contract.ts",
    ]);
    const offending = files.filter((file) => {
      const source = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      return /\bBun\.|\bprocess\.|\brequire\(|(?:from|import)\s*\(?\s*['"](?:node:|bun|fs|path|os|child_process)/.test(source);
    });
    expect(offending).toEqual([]);
  });

  // T111: the web client imports `writeAnswerOf`, and its tsconfig type-checks a type import's module too, so not even
  // a type may come from `gates.ts` (it imports `node:crypto`). The two types re-declared here equal gates.ts' own.
  test("the contract imports nothing from gates.ts, not even a type; its ReviewedFile and ReviewedMark equal gates.ts'", () => {
    const source = readFileSync(CONTRACT, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(source).not.toMatch(/from\s+['"][^'"]*gates\.ts['"]/);
    const sameFile: [GateReviewedFile] extends [ContractReviewedFile] ? ([ContractReviewedFile] extends [GateReviewedFile] ? true : false) : false = true;
    const sameMark: [GateReviewedMark] extends [ContractReviewedMark] ? ([ContractReviewedMark] extends [GateReviewedMark] ? true : false) : false = true;
    expect([sameFile, sameMark]).toEqual([true, true]);
    const mark: ContractReviewedMark = { gate: "reviewed", at: TS, files: { "spec.md": HEX_A, "plan.md": null, "tasks.md": HEX_C } };
    expect(Object.keys(mark.files)).toEqual([...REVIEWED_FILES]);
  });
});

// T98 (ISC-130.3): the root `CLAUDE.md` and the `README.md` name the same write paths as `WRITE_PATHS`. The expected
// words come from the constant at test time, so a path renamed or added there fails here until both documents follow.
describe("the documents name every write path", () => {
  const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"] as const;
  /** `specs/NNN-slug/`, the folder placeholder, as `WRITE_PATHS` itself writes it (the allocation creates it). */
  const folder = WRITE_PATHS.allocate.creates;
  /** A listed path as a document may write it: whole, or relative to the spec folder when it lies inside it. */
  const forms = (path: string): string[] => (path.startsWith(folder) && path !== folder ? [path, path.slice(folder.length)] : [path]);
  const docs = ["CLAUDE.md", "README.md"].map((name) => ({ name, text: readFileSync(join(ROOT, name), "utf8") }));

  test("each document names every path of every WRITE_PATHS entry, in backticks", () => {
    expect(folder).toBe("specs/NNN-slug/");
    for (const { name, text } of docs) {
      for (const [op, paths] of Object.entries(WRITE_PATHS)) {
        const listed: string[] = [...paths.writes, ...paths.removes, ...(paths.creates === null ? [] : [paths.creates])];
        for (const path of listed) {
          const named = forms(path).some((form) => text.includes(`\`${form}\``));
          expect({ name, op, path, named }).toEqual({ name, op, path, named: true });
        }
      }
    }
  });

  test("each document counts the write paths as WRITE_PATHS does, and no longer says two exceptions", () => {
    const total = Object.keys(WRITE_PATHS).length;
    const count: string = NUMBER_WORDS[total] ?? String(total);
    expect(count).toBe("eight");
    for (const { name, text } of docs) {
      // Whitespace as Markdown reads it: a phrase may wrap across a line.
      expect({ name, stale: /exactly\s+two\s+exceptions/i.test(text) }).toEqual({ name, stale: false });
      expect({ name, counted: new RegExp(`\\b${count}\\s+write\\s+paths\\b`, "i").test(text) }).toEqual({ name, counted: true });
    }
  });
});
