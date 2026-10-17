// The backlog route (spec 036, ISC-191 and ISC-191.1): `POST /api/workspaces/:ws/backlog` over a copy of the
// backlog-ranks fixture. An accepted move or priority writes `specs/backlog.md` as the whole list and appends exactly
// one line to `specs/backlog.events.jsonl`; a stale hash (409), a refusal (422) or an invalid body (400) leaves both
// files byte-identical and appends nothing. Probe name "backlog route".
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseActor } from "../core/src/actor.ts";
import { dashboardApi } from "../server/src/api.ts";
import type { ApiHandler } from "../server/src/http.ts";
import { type Registry, openRegistry } from "../server/src/registry.ts";
import { type BacklogRequest, allowForWorkspace, workspaceRoutes } from "../server/src/spec-routes.contract.ts";
import { writeAnswerOf } from "../server/src/writes.contract.ts";

const FIXTURE = join(import.meta.dir, "..", "core", "fixtures", "backlog-ranks");
const HOST = { Host: "127.0.0.1:7717" };
const sha256 = (bytes: string | Buffer): string => createHash("sha256").update(bytes).digest("hex");

const root = mkdtempSync(join(tmpdir(), "spectant-backlog-"));
let repo: string;
let registry: Registry | undefined;
let api: ApiHandler;

const backlogPath = (): string => join(repo, "specs", "backlog.md");
const eventsPath = (): string => join(repo, "specs", "backlog.events.jsonl");
const bytesOf = (path: string): string | null => (existsSync(path) ? readFileSync(path, "utf8") : null);

beforeEach(() => {
  registry?.close();
  repo = mkdtempSync(join(root, "repo-"));
  cpSync(FIXTURE, repo, { recursive: true });
  // The fixture's event log is FORMAT.md's example; each case starts without one, so every line is its own.
  rmSync(eventsPath(), { force: true });
  const opened = openRegistry(mkdtempSync(join(root, "data-")));
  opened.add(repo);
  registry = opened;
  api = dashboardApi({ registry: opened, services: () => Promise.resolve([]), now: () => new Date("2026-03-10T08:00:00Z") });
});

afterAll(() => {
  registry?.close();
  rmSync(root, { recursive: true, force: true });
});

const slug = (): string => registry?.list()[0]?.slug ?? "";

async function post(body: unknown, init: { method?: string } = {}): Promise<{ status: number; body: unknown; allow: string | null }> {
  const url = new URL(`http://127.0.0.1:7717${workspaceRoutes.backlog(slug())}`);
  const method = init.method ?? "POST";
  const req = new Request(url.href, { method, headers: { ...HOST, "Content-Type": "application/json" }, ...(method === "POST" ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}) });
  const res = await api(req, url);
  if (res === null) throw new Error("the backlog route was declined");
  return { status: res.status, body: await res.json(), allow: res.headers.get("Allow") };
}

const hashNow = (): string => sha256(bytesOf(backlogPath()) ?? "");

describe("backlog route", () => {
  test("backlog route: a move answers 200 with the new hash, writes the whole list and appends one event", async () => {
    const answer = await post({ op: "move", feature: "F1", before: "F2", hash: hashNow() } satisfies BacklogRequest);
    expect(answer.status).toBe(200);
    expect(writeAnswerOf("backlog", answer.status, answer.body)?.status).toBe(200);
    const text = bytesOf(backlogPath()) ?? "";
    expect(text.split("\n").filter((l) => l.startsWith("- "))).toEqual(["- F1 · P3", "- F3 · P2", "- F2 · P1", "- F4 · P3", "- F0 · P3"]);
    const body = answer.body as { hash: string; event: Record<string, unknown> };
    expect(body.hash).toBe(sha256(text));
    const lines = (bytesOf(eventsPath()) ?? "").split("\n").filter((l) => l !== "");
    expect(lines).toHaveLength(1);
    const event = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
    expect(Object.keys(event)).toEqual(["ts", "actor", "kind", "feature", "from", "to"]);
    expect(event).toMatchObject({ ts: "2026-03-10T08:00:00.000Z", kind: "move", feature: "F1", from: 3, to: 1 });
    expect(parseActor(String(event.actor)).legacy).toBe(false);
    expect(body.event).toEqual(event);
  });

  test("backlog route: a priority answers 200, keeps the order and appends one event after the first", async () => {
    await post({ op: "move", feature: "F4", before: "F3", hash: hashNow() });
    const answer = await post({ op: "priority", feature: "F0", priority: "P1", hash: hashNow() } satisfies BacklogRequest);
    expect(answer.status).toBe(200);
    expect((bytesOf(backlogPath()) ?? "").split("\n").filter((l) => l.startsWith("- "))).toEqual(["- F2 · P1", "- F4 · P3", "- F1 · P3", "- F3 · P2", "- F0 · P1"]);
    const lines = (bytesOf(eventsPath()) ?? "").split("\n").filter((l) => l !== "");
    expect(lines.map((l) => (JSON.parse(l) as { kind: string }).kind)).toEqual(["move", "priority"]);
    expect(JSON.parse(lines[1] ?? "{}")).toMatchObject({ kind: "priority", feature: "F0", from: "P3", to: "P1" });
  });

  test("backlog route: without specs/backlog.md the hash of the empty text writes the first file", async () => {
    rmSync(backlogPath());
    const answer = await post({ op: "priority", feature: "F2", priority: "P2", hash: sha256("") });
    expect(answer.status).toBe(200);
    expect(bytesOf(backlogPath())).toBe("# Backlog\n\n- F0 · P3\n- F1 · P3\n- F2 · P2\n- F3 · P3\n- F4 · P3\n");
  });

  test("backlog route: a stale hash is 409 with the hash now, both files byte-identical, no event", async () => {
    const before = bytesOf(backlogPath());
    const answer = await post({ op: "move", feature: "F1", before: "F2", hash: sha256("something else") });
    expect(answer.status).toBe(409);
    expect(answer.body).toEqual({ error: "hash-mismatch", files: ["specs/backlog.md"], expected: { backlog: hashNow() } });
    expect(writeAnswerOf("backlog", answer.status, answer.body)?.status).toBe(409);
    expect(bytesOf(backlogPath())).toBe(before);
    expect(existsSync(eventsPath())).toBe(false);
  });

  test.each([
    [{ op: "move", feature: "F1", before: "F3" }, "F1 belongs to Ferry 1.0 and F3 to Ferry 2.0: a feature moves only within its milestone"],
    [{ op: "move", feature: "F9", before: null }, "F9 is not a feature block of the master"],
    [{ op: "priority", feature: "F1", priority: "P7" }, 'priority "P7" is none of P1 to P4'],
  ])("backlog route: %j is 422 with the reason, both files byte-identical, no event", async (request, reason) => {
    const before = bytesOf(backlogPath());
    const answer = await post({ ...request, hash: hashNow() });
    expect(answer.status).toBe(422);
    expect(answer.body).toEqual({ error: "backlog-refused", reason });
    expect(writeAnswerOf("backlog", answer.status, answer.body)?.status).toBe(422);
    expect(bytesOf(backlogPath())).toBe(before);
    expect(existsSync(eventsPath())).toBe(false);
  });

  test.each([["not json"], [{ op: "move", feature: "F1", hash: "0".repeat(64) }], [{ op: "rename", feature: "F1", hash: "0".repeat(64) }], [{ op: "priority", feature: "F1", priority: "P1" }]])(
    "backlog route: the body %j is 400 invalid-body, nothing written",
    async (body) => {
      const before = bytesOf(backlogPath());
      const answer = await post(body);
      expect(answer.status).toBe(400);
      expect(answer.body).toEqual({ error: "invalid-body" });
      expect(bytesOf(backlogPath())).toBe(before);
      expect(existsSync(eventsPath())).toBe(false);
    },
  );

  test("backlog route: any other method is 405 with Allow: POST", async () => {
    const answer = await post(null, { method: "GET" });
    expect(answer.status).toBe(405);
    expect(answer.allow).toBe(allowForWorkspace("backlog"));
    expect(answer.allow).toBe("POST");
  });
});
