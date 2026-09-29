// Local dev services for the live indicator (T48, ISC-16, ISC-2, ISC-3). The listener source is injected as fake
// `lsof -F` output; "answers HTTP" is a real `Bun.serve` on an ephemeral loopback port, "nothing listens" is a port
// freed right before the probe, and "answers but not HTTP" is a raw TCP listener that never replies.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type DevService, listServices, type LsofRun, probeHttp } from "../server/src/services.ts";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

function tempRepo(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "spectant-services-")));
  mkdirSync(join(root, "repo", ".claude", "worktrees", "feature-a"), { recursive: true });
  mkdirSync(join(root, "elsewhere"), { recursive: true });
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function httpServer(): number {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("ok", { status: 404 }) });
  cleanups.push(() => void server.stop(true));
  return server.port ?? 0;
}

/** A port that was free a moment ago: bound, read, released. */
function deadPort(): number {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("") });
  const port = server.port ?? 0;
  void server.stop(true);
  return port;
}

/** Accepts TCP connections and never sends a byte, so only the timeout can end the probe. */
function silentTcp(): number {
  const listener = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() { /* never replies */ } } });
  cleanups.push(() => listener.stop(true));
  return listener.port;
}

type Listener = { pid: number; command: string; binds: string[]; cwd: string };

/** A fake `lsof`: answers the listener query and the cwd query from one table, like the real tool's `-F` output. */
function fakeLsof(listeners: Listener[], calls: string[][] = []): LsofRun {
  return (args) => {
    calls.push(args);
    if (args.includes("-sTCP:LISTEN")) {
      const out = listeners.flatMap((l) => [`p${l.pid}`, `c${l.command}`, ...l.binds.flatMap((b, i) => [`f${10 + i}`, `n${b}`])]);
      return Promise.resolve({ code: 0, stdout: out.join("\n") + "\n" });
    }
    const pids = (args[args.indexOf("-p") + 1] ?? "").split(",").map(Number);
    const out = listeners.filter((l) => pids.includes(l.pid)).flatMap((l) => [`p${l.pid}`, "fcwd", `n${l.cwd}`]);
    return Promise.resolve({ code: 0, stdout: out.join("\n") + "\n" });
  };
}

describe("listServices (T48)", () => {
  test("keeps the repo's and its worktrees' listeners that answer HTTP, drops the rest", async () => {
    const root = tempRepo();
    const repoRoot = join(root, "repo");
    const web = httpServer();
    const api = httpServer();
    const foreign = httpServer();
    const gone = deadPort();
    const silent = silentTcp();
    const calls: string[][] = [];
    const runLsof = fakeLsof(
      [
        { pid: 101, command: "node", binds: [`127.0.0.1:${web}`, `[::1]:${web}`], cwd: repoRoot },
        { pid: 102, command: "java", binds: [`*:${api}`], cwd: join(repoRoot, ".claude", "worktrees", "feature-a", "server") },
        { pid: 103, command: "bun", binds: [`127.0.0.1:${foreign}`], cwd: join(root, "elsewhere") },
        { pid: 104, command: "python3.12", binds: [`127.0.0.1:${gone}`], cwd: join(repoRoot, "tools") },
        { pid: 105, command: "ruby", binds: [`127.0.0.1:${silent}`], cwd: repoRoot },
        { pid: 106, command: "node", binds: [`192.168.1.20:${web + 1}`], cwd: repoRoot },
        { pid: 107, command: "node", binds: [`127.0.0.1:${foreign}`], cwd: `${repoRoot}-sibling` },
      ],
      calls,
    );

    const found = await listServices({ repoRoot, labels: new Map([[web, "Web dev"]]), runLsof });

    const expected: DevService[] = [
      { port: web, label: "Web dev", kind: "node", pid: 101, worktree: false },
      { port: api, label: "java", kind: "java", pid: 102, worktree: true },
    ];
    expect(found).toEqual(expected.sort((a, b) => a.port - b.port));
    // One pass for the listeners, one for the working directories.
    expect(calls).toHaveLength(2);
    expect(calls[1]?.slice(0, 4)).toEqual(["-a", "-d", "cwd", "-p"]);
  });

  test("labels come from the dev_services map, else the process name; kind from the process name", async () => {
    const root = tempRepo();
    const repoRoot = join(root, "repo");
    const ports = [httpServer(), httpServer(), httpServer(), httpServer(), httpServer()];
    const names = ["node", "java", "bun", "Python", "ControlCenter"];
    const runLsof = fakeLsof(names.map((command, i) => ({ pid: 200 + i, command, binds: [`127.0.0.1:${ports[i] ?? 0}`], cwd: repoRoot })));

    const found = await listServices({ repoRoot, labels: { [ports[2] ?? 0]: "Spectant" }, runLsof });

    const byPid = new Map(found.map((s) => [s.pid, s]));
    expect([200, 201, 202, 203, 204].map((pid) => byPid.get(pid)?.kind)).toEqual(["node", "java", "bun", "python", "other"]);
    expect(byPid.get(202)?.label).toBe("Spectant");
    expect(byPid.get(204)?.label).toBe("ControlCenter");
  });

  test("probes loopback only and never returns a path (ISC-2, ISC-3)", async () => {
    const root = tempRepo();
    const repoRoot = join(root, "repo");
    const hosts: string[] = [];
    const runLsof = fakeLsof([
      { pid: 301, command: "node", binds: ["127.0.0.1:4200"], cwd: repoRoot },
      { pid: 302, command: "node", binds: ["[::1]:4300"], cwd: repoRoot },
      { pid: 303, command: "java", binds: ["*:8080"], cwd: join(repoRoot, ".claude", "worktrees", "feature-a") },
      { pid: 304, command: "java", binds: ["10.0.0.5:8081"], cwd: repoRoot },
    ]);

    const found = await listServices({
      repoRoot,
      labels: new Map(),
      runLsof,
      probe: (host) => {
        hosts.push(host);
        return Promise.resolve(true);
      },
    });

    expect(found.map((s) => s.port)).toEqual([4200, 4300, 8080]);
    expect(new Set(hosts)).toEqual(new Set(["127.0.0.1", "::1"]));
    const json = JSON.stringify(found);
    expect(json).not.toContain(root);
    expect(json).not.toContain("/");
    for (const s of found) expect(Object.keys(s).sort()).toEqual(["kind", "label", "pid", "port", "worktree"]);
  });

  test("is empty, never a throw, when lsof is missing or fails", async () => {
    const repoRoot = join(tempRepo(), "repo");
    expect(await listServices({ repoRoot, labels: new Map(), runLsof: () => Promise.resolve(null) })).toEqual([]);
    expect(await listServices({ repoRoot, labels: new Map(), runLsof: () => Promise.resolve({ code: 1, stdout: "" }) })).toEqual([]);
    expect(await listServices({ repoRoot, labels: new Map(), runLsof: () => Promise.reject(new Error("spawn failed")) })).toEqual([]);

    // The default runner with no lsof on PATH.
    const saved = process.env.PATH;
    process.env.PATH = join(repoRoot, "no-bin");
    try {
      expect(await listServices({ repoRoot, labels: new Map() })).toEqual([]);
    } finally {
      process.env.PATH = saved;
    }
  });

  test("with the real lsof, finds a Bun.serve this process started inside the repo", async () => {
    if (!Bun.which("lsof")) return;
    const port = httpServer();
    const found = await listServices({ repoRoot: realpathSync(process.cwd()), labels: new Map([[port, "Test server"]]) });
    expect(found).toContainEqual({ port, label: "Test server", kind: "bun", pid: process.pid, worktree: false });
  }, 15_000);
});

describe("probeHttp (T48)", () => {
  test("any HTTP status answers; refused and silent ports do not, within the timeout", async () => {
    expect(await probeHttp("127.0.0.1", httpServer())).toBe(true);
    expect(await probeHttp("127.0.0.1", deadPort())).toBe(false);
    const started = performance.now();
    expect(await probeHttp("127.0.0.1", silentTcp())).toBe(false);
    expect(performance.now() - started).toBeLessThan(1_000);
  });

  test("refuses a non-loopback host without connecting (ISC-2)", async () => {
    expect(await probeHttp("example.com", 80)).toBe(false);
    expect(await probeHttp("10.0.0.5", 80)).toBe(false);
  });
});
