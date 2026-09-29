// Harbor 002 holds every card state of the round board (ISC-88, spec 002 T8). The web e2e renders this fixture and
// expects all eleven states; this test proves the fixture carries them before any renderer exists.
//
// Reads fixture files only and parses nothing through `core/`: the regexes below are test helpers for the few fields
// this check needs, not a parser of the spec format.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const HARBOR = join(import.meta.dir, "..", "fixtures", "harbor");
const SPEC_DIR = join(HARBOR, "specs", "002-web-console");

const ELEVEN = [
  "waiting",
  "dispatched",
  "running",
  "question",
  "concerns",
  "fail",
  "done",
  "closed",
  "absent",
  "operator open",
  "operator done",
];

interface RoundTask {
  id: string;
  claim: string;
  lane: string;
  text: string;
  state: string;
  reason: string;
  note?: string;
  builder?: string;
  reader?: string;
  verdict?: string;
}

interface Round {
  v: number;
  round: number;
  ts: string;
  width: number;
  dispatched: string[];
  tasks: RoundTask[];
  claims: { closed: string[]; open: string[]; closed_this_round: string[] };
  progress: string;
  stop?: string;
}

interface Activity {
  ts: string;
  event: "claim" | "release";
  claim: string;
  session: string;
  task?: string;
  worktree?: string;
}

function jsonLines<T>(path: string): T[] {
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as T);
}

/** Test helper: `- [ ]`/`- [x]` task lines of tasks.md as id, checkbox and lane. */
function testOnlyTaskLines(text: string): Array<{ id: string; checked: boolean; lane: string }> {
  const out: Array<{ id: string; checked: boolean; lane: string }> = [];
  for (const match of text.matchAll(/^- \[([ xX])\] (T\d+) · [^—\n]*?([a-z]+) — /gm)) {
    out.push({ id: match[2] ?? "", checked: match[1] !== " ", lane: match[3] ?? "" });
  }
  return out;
}

const rounds = jsonLines<Round>(join(SPEC_DIR, "rounds.jsonl"));
const activity = jsonLines<Activity>(join(HARBOR, ".spectant", "activity.jsonl"));
const tasksMd = testOnlyTaskLines(readFileSync(join(SPEC_DIR, "tasks.md"), "utf8"));
const specMd = readFileSync(join(SPEC_DIR, "spec.md"), "utf8");
const last = rounds.at(-1);
const allTasks = rounds.flatMap((round) => round.tasks);

describe("harbor 002 card states", () => {
  test("three rounds, dated in March 2026, the last one carrying the tasks.md ids", () => {
    expect(rounds.map((round) => round.round)).toEqual([1, 2, 3]);
    for (const stamp of [...rounds.map((round) => round.ts), ...activity.map((line) => line.ts)]) {
      expect(stamp).toMatch(/^2026-03-\d\dT\d\d:\d\d:\d\dZ$/);
    }
    expect(last?.tasks.map((task) => task.id)).toEqual(tasksMd.map((task) => task.id));
  });

  test("all eleven states occur across the rounds and the live layer", () => {
    const found = new Set(allTasks.map((task) => (task.state === "held" ? "waiting" : task.state)));

    // running: a claim line without a release, on a task the last round recorded as dispatched
    const released = new Set(activity.filter((line) => line.event === "release").map((line) => `${line.claim} ${line.session}`));
    const open = activity.filter((line) => line.event === "claim" && !released.has(`${line.claim} ${line.session}`));
    const inFlight = new Set(last?.tasks.filter((task) => task.state === "dispatched").map((task) => task.id));
    if (open.some((line) => line.task !== undefined && inFlight.has(line.task))) found.add("running");

    // absent: an id of rounds 1–2 that tasks.md no longer has (struck in a re-cut)
    const current = new Set(tasksMd.map((task) => task.id));
    const earlier = rounds.slice(0, -1).flatMap((round) => round.tasks.map((task) => task.id));
    if (earlier.some((id) => !current.has(id))) found.add("absent");

    for (const task of tasksMd.filter((line) => line.lane === "operator")) {
      found.add(task.checked ? "operator done" : "operator open");
    }

    expect([...found].sort()).toEqual([...ELEVEN].sort());
  });

  test("the live layer holds one open claim and one released pair", () => {
    const claims = activity.filter((line) => line.event === "claim");
    const releases = activity.filter((line) => line.event === "release");
    expect(claims.length).toBe(2);
    expect(releases.length).toBe(1);
    for (const line of claims) {
      expect(line.session).toMatch(/^spec-002-ISC-\d+$/);
      expect(line.worktree).toMatch(/^wt-\d+$/);
      expect(line.task).toMatch(/^T\d+$/);
    }
  });

  test("one stop, a retry, a question, concerns with a verdict and a fail", () => {
    const stops = rounds.filter((round) => round.stop !== undefined);
    expect(stops.map((round) => [round.round, round.stop])).toEqual([[3, "a decision only the principal can make"]]);

    // a retry: dispatched again in a later round, its note naming what to change
    const retries = rounds.flatMap((round, i) =>
      round.tasks.filter(
        (task) =>
          task.note?.startsWith("retry with:") === true &&
          round.dispatched.includes(task.id) &&
          rounds.slice(0, i).some((earlier) => earlier.dispatched.includes(task.id)),
      ),
    );
    expect(retries.length).toBeGreaterThanOrEqual(1);

    const questions = allTasks.filter((task) => task.state === "question");
    expect(questions.length).toBeGreaterThanOrEqual(1);
    expect(questions.every((task) => task.note?.startsWith("question: ") === true)).toBe(true);

    const concerns = allTasks.filter((task) => task.state === "concerns");
    expect(concerns.length).toBeGreaterThanOrEqual(1);
    expect(concerns.every((task) => task.reader === "Forge" && task.verdict === "concerns")).toBe(true);

    const fails = allTasks.filter((task) => task.state === "fail");
    expect(fails.length).toBeGreaterThanOrEqual(1);
    expect(fails.every((task) => /^probe exit [1-9]\d* — /.test(task.note ?? ""))).toBe(true);
  });

  test("the last round's closed claims are the claims spec.md ticks", () => {
    const ticked = [...specMd.matchAll(/^- \[x\] (ISC-[\d.]+):/gm)].map((match) => match[1] ?? "");
    expect(last?.claims.closed).toEqual(ticked);
    expect(last?.progress).toBe(`${ticked.length}/${ticked.length + (last?.claims.open.length ?? 0)}`);
  });
});
