/**
 * Local dev services for the live indicator (T48, ISC-16): the TCP listeners a workspace's build left running.
 *
 * A service is a listener reachable on loopback whose process runs with its working directory inside the repository
 * or inside one of its worktrees under `<repoRoot>/.claude/worktrees/`, and that answers an HTTP request. Found on
 * every call from `lsof`, nothing recorded: a server stopped since is simply gone. One `lsof` pass for the listeners,
 * one for their working directories, then one parallel probe with a 300 ms timeout. No inference, no lock, nothing
 * written anywhere (ISC-15).
 *
 * ISC-2: the probe is a raw HTTP/1.0 request over `Bun.connect` to `127.0.0.1` or `::1` only. It is not `fetch`, so
 * no proxy variable and no redirect can carry it off the machine, and `probeHttp` refuses any other host outright.
 *
 * ISC-3: a `DevService` carries no path. Whether the process runs in a worktree is a boolean.
 *
 * When `lsof` is not on PATH, fails to spawn or exits non-zero, the result is `[]`, never a throw: a missing tool must
 * not break the dashboard.
 */
import { realpathSync } from "node:fs";
import { resolve, sep } from "node:path";

export type DevServiceKind = "node" | "java" | "bun" | "python" | "other";

export type DevService = {
  port: number;
  /** From the constitution's `dev_services:` map, else the process name. */
  label: string;
  kind: DevServiceKind;
  pid?: number;
  /** True when the process runs inside `<repoRoot>/.claude/worktrees/<name>`. */
  worktree?: boolean;
};

/** Runs `lsof` with these arguments. Null when `lsof` is not on PATH. */
export type LsofRun = (args: string[]) => Promise<{ code: number; stdout: string } | null>;

/** True when `host:port` answers HTTP. Only ever called with `127.0.0.1` or `::1`. */
export type HttpProbe = (host: LoopbackHost, port: number) => Promise<boolean>;

export type LoopbackHost = "127.0.0.1" | "::1";

export type ListServicesOptions = {
  /** The workspace's absolute directory. Server-internal; never part of the result. */
  repoRoot: string;
  /** The parsed `dev_services:` key: port → label. */
  labels: ReadonlyMap<number, string> | Readonly<Record<number, string>>;
  runLsof?: LsofRun;
  probe?: HttpProbe;
};

export const PROBE_TIMEOUT_MS = 300;

export async function listServices(options: ListServicesOptions): Promise<DevService[]> {
  const runLsof = options.runLsof ?? defaultLsof;
  const probe = options.probe ?? probeHttp;
  try {
    const listed = await runLsof(["-nP", "-iTCP", "-sTCP:LISTEN", "+c", "0", "-Fpcn"]);
    if (listed?.code !== 0) return [];
    const listeners = parseListeners(listed.stdout);
    if (!listeners.length) return [];

    const pids = [...new Set(listeners.map((l) => l.pid))];
    // A pid that exited between the two passes makes lsof exit 1 while still reporting the others: keep that output.
    const cwdRun = await runLsof(["-a", "-d", "cwd", "-p", pids.join(","), "-Fpn"]);
    const cwds = parseCwds(cwdRun?.stdout ?? "");

    const roots = repoRoots(options.repoRoot);
    const candidates: Array<Listener & { worktree: boolean; host: LoopbackHost }> = [];
    for (const listener of listeners) {
      const cwd = cwds.get(listener.pid);
      const place = cwd === undefined ? null : locate(cwd, roots);
      const host = probeHost(listener.binds);
      if (place && host) candidates.push({ ...listener, worktree: place === "worktree", host });
    }

    const answers = await Promise.all(candidates.map((c) => probe(c.host, c.port).catch(() => false)));
    const seen = new Set<number>();
    const services: DevService[] = [];
    candidates.forEach((c, i) => {
      if (!answers[i] || seen.has(c.port)) return;
      seen.add(c.port);
      services.push({ port: c.port, label: labelFor(options.labels, c.port) ?? c.process, kind: kindOf(c.process), pid: c.pid, worktree: c.worktree });
    });
    return services.sort((a, b) => a.port - b.port);
  } catch {
    return [];
  }
}

/**
 * Sends `GET / HTTP/1.0` to a loopback port and resolves true on any HTTP status line. Refused, silent past
 * `timeoutMs`, or not HTTP → false. Any host other than `127.0.0.1` or `::1` → false without connecting (ISC-2).
 */
export function probeHttp(host: string, port: number, timeoutMs = PROBE_TIMEOUT_MS): Promise<boolean> {
  if (host !== "127.0.0.1" && host !== "::1") return Promise.resolve(false);
  return new Promise<boolean>((done) => {
    let settled = false;
    let received = "";
    let socket: { end(): void } | undefined;
    const finish = (answer: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket?.end();
      done(answer);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    const hostHeader = host === "::1" ? `[::1]:${port}` : `${host}:${port}`;
    Bun.connect({
      hostname: host,
      port,
      socket: {
        open(s) {
          s.write(`GET / HTTP/1.0\r\nHost: ${hostHeader}\r\nConnection: close\r\n\r\n`);
        },
        data(_s, chunk) {
          received += chunk.toString("latin1");
          if (received.length >= 5) finish(received.startsWith("HTTP/"));
        },
        close() {
          finish(false);
        },
        error() {
          finish(false);
        },
        connectError() {
          finish(false);
        },
      },
    }).then(
      (s) => {
        socket = s;
        if (settled) s.end();
      },
      () => finish(false),
    );
  });
}

type Listener = { pid: number; process: string; port: number; binds: string[] };

/** `lsof -F pcn` field output: `p<pid>`, `c<command>`, then one `n<addr>:<port>` per socket. Grouped by pid+port. */
function parseListeners(stdout: string): Listener[] {
  const byKey = new Map<string, Listener>();
  let pid = 0;
  let command = "";
  for (const line of stdout.split("\n")) {
    const field = line.charAt(0);
    const value = line.slice(1);
    if (field === "p") pid = Number.parseInt(value, 10);
    else if (field === "c") command = value;
    else if (field === "n") {
      const colon = value.lastIndexOf(":");
      const port = Number.parseInt(value.slice(colon + 1), 10);
      if (!pid || !Number.isInteger(port) || port <= 0 || colon < 0) continue;
      const bind = value.slice(0, colon).replace(/^\[(.*)\]$/, "$1");
      const key = `${pid}:${port}`;
      const known = byKey.get(key);
      if (known) known.binds.push(bind);
      else byKey.set(key, { pid, process: command, port, binds: [bind] });
    }
  }
  return [...byKey.values()];
}

/** `lsof -a -d cwd -p … -F pn` field output: `p<pid>` then `n<cwd>`. */
function parseCwds(stdout: string): Map<number, string> {
  const cwds = new Map<number, string>();
  let pid = 0;
  for (const line of stdout.split("\n")) {
    if (line.startsWith("p")) pid = Number.parseInt(line.slice(1), 10);
    else if (line.startsWith("n") && pid) cwds.set(pid, line.slice(1));
  }
  return cwds;
}

/** The repo root as given and as realpath, since `lsof` reports resolved working directories. */
function repoRoots(repoRoot: string): string[] {
  const given = resolve(repoRoot);
  try {
    return [...new Set([given, realpathSync(given)])];
  } catch {
    return [given];
  }
}

/** Where a working directory lies: in the repo, in one of its worktrees, or outside (null). */
function locate(cwd: string, roots: string[]): "repo" | "worktree" | null {
  for (const root of roots) {
    if (cwd !== root && !cwd.startsWith(root + sep)) continue;
    const worktrees = [root, ".claude", "worktrees"].join(sep) + sep;
    const name = cwd.startsWith(worktrees) ? cwd.slice(worktrees.length).split(sep)[0] : "";
    return name ? "worktree" : "repo";
  }
  return null;
}

/**
 * The loopback address to probe a listener on: IPv4 loopback for a 127.x or wildcard bind, `::1` for an IPv6 loopback
 * or wildcard bind, null for a listener bound only to a specific external interface (not a local dev service).
 */
function probeHost(binds: string[]): LoopbackHost | null {
  if (binds.some((b) => b === "*" || b === "0.0.0.0" || b === "localhost" || b.startsWith("127."))) return "127.0.0.1";
  if (binds.some((b) => b === "::1" || b === "::")) return "::1";
  return null;
}

function labelFor(labels: ListServicesOptions["labels"], port: number): string | undefined {
  if (labels instanceof Map) return (labels as ReadonlyMap<number, string>).get(port);
  return (labels as Readonly<Record<number, string>>)[port];
}

function kindOf(process: string): DevServiceKind {
  const name = process.toLowerCase();
  if (name === "node" || name.startsWith("node")) return "node";
  if (name === "java") return "java";
  if (name === "bun") return "bun";
  if (name.startsWith("python")) return "python";
  return "other";
}

const defaultLsof: LsofRun = async (args) => {
  const lsof = Bun.which("lsof", { PATH: process.env.PATH ?? "" });
  if (!lsof) return null;
  const child = Bun.spawn([lsof, ...args], { stdout: "pipe", stderr: "ignore", stdin: "ignore" });
  const [stdout, code] = await Promise.all([new Response(child.stdout).text(), child.exited]);
  return { code, stdout };
};
