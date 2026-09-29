#!/usr/bin/env bun
/**
 * test:offline:server — the compiled Linux binary in `docker run --network none` through a scripted session (T53,
 * ISC-2 "nothing leaves the machine"; plan 001 § Affected Files). The Playwright half of ISC-2 is T77
 * (`bun run e2e -- offline`).
 *
 * Usage: bun tests/offline-server.ts [--platform linux/arm64|linux/amd64]
 *        bun run test:offline:server [-- --platform …]
 *
 * The platform is `--platform`, else `E2E_PLATFORM` (the override `web/e2e/container.ts` established), else the
 * host's architecture, so Apple Silicon runs `linux/arm64` natively.
 *
 * Exit codes: 0 every check passed; 1 a check failed, a usage error, or the harness itself broke; 2 SKIPPED because
 * Docker is not available (a skip is never a pass).
 *
 * Host side (default mode):
 *  1. makes sure `dist/spectant-linux-<arch>` exists, building only that target with `scripts/build.ts` when not;
 *  2. runs `ubuntu:24.04`, pinned per platform by manifest digest (`IMAGES`), with `--network none`: `dist/` read-only at `/opt/spectant`,
 *     `core/fixtures/harbor` read-only at `/repo`, a fresh temporary data directory at `/data` (`XDG_DATA_HOME`),
 *     this file read-only at `/harness/offline-server.ts`, and an `/etc/resolv.conf` that points DNS at
 *     `127.0.0.1:53`;
 *  3. prints a table of the container's checks and a one-line verdict.
 *
 * Container side (`--session`): the image has no curl, no bun and no node. The script runs under the spectant
 * binary itself with `BUN_BE_BUN=1`, which makes a Bun-compiled executable behave as the `bun` CLI, so the HTTP
 * client is Bun's `fetch`. The session removes that variable before it starts spectant, so the app runs as itself.
 *  - proves the box has no network but loopback (only `lo` is up, and the IPv4 main route table is empty);
 *  - arms a DNS trap: a UDP listener on `127.0.0.1:53` that records each query's name, and proves it with one
 *    self-test lookup in a child process that is killed before the session starts;
 *    `--network none` alone makes an outbound attempt fail, but an app that swallows the error would pass silently;
 *    every real outbound request starts with a name lookup, and the trap counts it whether or not the app hides it;
 *  - `spectant add /repo`, `spectant list`, then `spectant --no-browser --port 7717` in the background;
 *  - GET and HEAD `/`, one hashed `main-*.js`, the deep link `/w/<slug>` (SPA fallback), GET and PUT
 *    `/api/settings`, GET `/api/workspaces`: the pages must answer 200, the API 200/304/4xx; a connection error or a
 *    5xx fails;
 *  - stops the server with SIGTERM and expects exit 0;
 *  - fails on any DNS query seen by the trap and on any line in the combined stderr matching
 *    `ENOTFOUND|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|fetch failed|Unable to connect|FailedToOpenSocket`.
 *
 * Every check prints one `CHECK|<name>|ok|fail|<detail>` line, the format `tests/install/run.ts` uses.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
/**
 * The install test's base (`tests/install/Dockerfile`, `ubuntu:24.04`), pinned per platform by manifest digest. Both
 * come from the index `ubuntu:24.04@sha256:008173c23f95b170204355c12626cb5a965d779a7e1283b09e9cffbb1bf33ca3`
 * (2026-09-11). Not the index digest itself: Docker's classic image store maps one repo digest to one local image,
 * so once one platform of the index is pulled, running the other by the same digest fails with "cannot overwrite
 * digest". Bumping the base means taking both manifest digests from `docker buildx imagetools inspect <index>`.
 */
export const IMAGES: Record<DockerPlatform, string> = {
  "linux/arm64": "ubuntu@sha256:11dc1ccb427f0464a2369e645454c272bb0baece7357c892ba69d313b3a332cf",
  "linux/amd64": "ubuntu@sha256:496754492fb28b4d3049432f2ca787449331e23fb14f0dd3fffea86bf5a93eb4",
};
const FIXTURE = "core/fixtures/harbor";
const PORT = 7717;
const RUN_TIMEOUT_MS = 3 * 60_000;
const START_TIMEOUT_MS = 15_000;
const STOP_TIMEOUT_MS = 5_000;
const FETCH_TIMEOUT_MS = 5_000;
const DNS_SELFTEST_MS = 3_000;
const DNS_QUIET_MS = 1_500;
const SELFTEST_HOST = "dns-trap-selftest.example";

export const EXIT_PASSED = 0;
export const EXIT_FAILED = 1;
export const EXIT_SKIPPED = 2;

const USAGE = "usage: bun tests/offline-server.ts [--platform linux/arm64|linux/amd64]";
const PLATFORMS = ["linux/arm64", "linux/amd64"] as const;

export type DockerPlatform = (typeof PLATFORMS)[number];
export type Platform = { docker: DockerPlatform; target: "linux-arm64" | "linux-x64" };
export type Args = { mode: "host"; platform: DockerPlatform | undefined } | { mode: "session" } | { mode: "help" };
export type Check = { name: string; ok: boolean; detail: string };

export class UsageError extends Error {}

function asPlatform(value: string | undefined, source: string): DockerPlatform {
  const found = PLATFORMS.find((platform) => platform === value);
  if (found === undefined) {
    throw new UsageError(`${source} must be one of ${PLATFORMS.join(", ")}, got ${JSON.stringify(value ?? null)}`);
  }
  return found;
}

export function parseArgs(argv: string[]): Args {
  let platform: DockerPlatform | undefined;
  let session = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    if (arg === "--") continue;
    if (arg === "--help" || arg === "-h") return { mode: "help" };
    if (arg === "--session") session = true;
    else if (arg === "--platform") platform = asPlatform(argv[++i], "--platform");
    else if (arg.startsWith("--platform=")) platform = asPlatform(arg.slice("--platform=".length), "--platform");
    else throw new UsageError(`unknown argument ${arg}; ${USAGE}`);
  }
  if (session && platform !== undefined) throw new UsageError("--session takes no other argument");
  return session ? { mode: "session" } : { mode: "host", platform };
}

/** `--platform`, else `E2E_PLATFORM`, else the host architecture. */
export function resolvePlatform(
  flag: DockerPlatform | undefined,
  env: Record<string, string | undefined>,
  hostArch: string,
): Platform {
  let docker = flag;
  if (docker === undefined && env.E2E_PLATFORM !== undefined) docker = asPlatform(env.E2E_PLATFORM, "E2E_PLATFORM");
  if (docker === undefined) {
    if (hostArch === "arm64") docker = "linux/arm64";
    else if (hostArch === "x64") docker = "linux/amd64";
    else throw new UsageError(`no linux target for host architecture ${hostArch}; pass --platform`);
  }
  return { docker, target: docker === "linux/arm64" ? "linux-arm64" : "linux-x64" };
}

const OUTBOUND = /ENOTFOUND|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|fetch failed|Unable to connect|FailedToOpenSocket/i;

/** Every stderr line that reports a DNS lookup or an outbound connection attempt. */
export function outboundHits(stderr: string): string[] {
  return stderr.split("\n").filter((line) => OUTBOUND.test(line));
}

/** A request counts as answered on 200, 304 or any 4xx; 0 (no connection) and 5xx do not. */
export function isAnswered(status: number): boolean {
  return status === 200 || status === 304 || (status >= 400 && status < 500);
}

/**
 * The interfaces that are administratively up (IFF_UP, bit 0x1 of `/sys/class/net/<name>/flags`), sorted. Under
 * `--network none` only `lo` may be up; Docker Desktop's kernel also lists dormant tunnel devices, all down.
 */
export function upInterfaces(flags: Record<string, string>): string[] {
  return Object.entries(flags)
    .filter(([, value]) => (Number.parseInt(value.trim(), 16) & 0x1) === 0x1)
    .map(([name]) => name)
    .sort();
}

const QTYPES: Record<number, string> = { 1: "A", 5: "CNAME", 12: "PTR", 15: "MX", 16: "TXT", 28: "AAAA", 33: "SRV", 65: "HTTPS" };

/** `<name> <type>` of the first question in a DNS query packet, so a trapped lookup says what it was for. */
export function dnsQueryName(packet: Uint8Array): string {
  const labels: string[] = [];
  let at = 12;
  while (at < packet.length) {
    const length = packet[at] ?? 0;
    if (length === 0) {
      const qtype = ((packet[at + 1] ?? 0) << 8) | (packet[at + 2] ?? 0);
      if (at + 2 >= packet.length || labels.length === 0) break;
      return `${labels.join(".")} ${QTYPES[qtype] ?? `TYPE${qtype}`}`;
    }
    if (length > 63 || at + 1 + length > packet.length) break;
    labels.push(new TextDecoder().decode(packet.subarray(at + 1, at + 1 + length)));
    at += 1 + length;
  }
  return `(unparsable packet, ${packet.length} bytes)`;
}

export function parseChecks(out: string): Check[] {
  return out
    .split("\n")
    .filter((line) => line.startsWith("CHECK|"))
    .map((line) => {
      const [, name = "", verdict = "", ...detail] = line.split("|");
      return { name, ok: verdict === "ok", detail: detail.join("|") };
    });
}

// ---------------------------------------------------------------------------------------------------------------
// Container side
// ---------------------------------------------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}

/** Drains a stream into a growing string, so a chatty child never blocks on a full pipe. */
function collect(stream: ReadableStream<Uint8Array>, sink: { text: string }): Promise<void> {
  return (async () => {
    const decoder = new TextDecoder();
    for await (const chunk of stream) sink.text += decoder.decode(chunk, { stream: true });
  })();
}

async function session(): Promise<number> {
  const failures: string[] = [];
  const check = (name: string, ok: boolean, detail: string): void => {
    console.log(`CHECK|${name}|${ok ? "ok" : "fail"}|${detail.replaceAll("\n", " ")}`);
    if (!ok) failures.push(name);
  };

  const bin = process.env.SPECTANT_BIN;
  if (bin === undefined || !existsSync(bin)) {
    check("binary present", false, `SPECTANT_BIN=${bin ?? "(unset)"}`);
    return EXIT_FAILED;
  }
  // The app runs as itself: without BUN_BE_BUN, with its data directory on the /data mount.
  const env: Record<string, string | undefined> = { ...process.env, XDG_DATA_HOME: "/data" };
  delete env.BUN_BE_BUN;

  const flags = Object.fromEntries(
    readdirSync("/sys/class/net")
      .filter((name) => existsSync(`/sys/class/net/${name}/flags`)) // `bonding_masters` is a file, not an interface
      .map((name) => [name, readFileSync(`/sys/class/net/${name}/flags`, "utf8")]),
  );
  const upIfs = upInterfaces(flags);
  // Loopback routes live in the kernel's local table; the main table must hold no route at all, so no default route.
  const routes = readFileSync("/proc/net/route", "utf8").trim().split("\n").slice(1);
  check(
    "network none",
    upIfs.length === 1 && upIfs[0] === "lo" && routes.length === 0,
    `up: ${upIfs.join(", ")}; IPv4 routes: ${routes.length}`,
  );

  let queries: string[] = [];
  const trap = await Bun.udpSocket({
    hostname: "127.0.0.1",
    port: 53,
    socket: {
      data(_socket, packet) {
        queries.push(dnsQueryName(packet));
      },
    },
  });
  // The self-test lookup never gets an answer; it only has to reach the trap. It runs in a child process (this same
  // binary in Bun mode, BUN_BE_BUN still set) that is killed once the trap has seen it: the resolver keeps retrying
  // in the background for seconds, and those retries must die with it instead of landing in the session's tally.
  const probe = Bun.spawn([process.execPath, "-e", `require("node:dns").lookup(${JSON.stringify(SELFTEST_HOST)}, () => {})`], {
    stdout: "ignore",
    stderr: "ignore",
    stdin: "ignore",
  });
  const probeDeadline = Date.now() + DNS_SELFTEST_MS;
  while (queries.length === 0 && Date.now() < probeDeadline) await sleep(50);
  probe.kill("SIGKILL");
  await probe.exited;
  await sleep(DNS_QUIET_MS); // a datagram already in flight when the child died
  const selftest = queries.filter((query) => query.startsWith(`${SELFTEST_HOST} `)).length;
  check("DNS trap armed", selftest > 0, `self-test lookup of ${SELFTEST_HOST} reached 127.0.0.1:53 ${selftest}x`);
  queries = [];

  let stderr = "";
  const cli = (args: string[]): { code: number; out: string } => {
    const result = Bun.spawnSync([bin, ...args], { env, stdout: "pipe", stderr: "pipe", stdin: "ignore" });
    stderr += result.stderr.toString();
    return { code: result.exitCode, out: result.stdout.toString() };
  };

  const added = cli(["add", "/repo"]);
  const slug = /^added (\S+) · repo$/m.exec(added.out)?.[1];
  check("spectant add /repo", added.code === 0 && slug !== undefined, `exit ${added.code}: ${added.out.trim()}`);
  const listed = cli(["list"]);
  check(
    "spectant list",
    listed.code === 0 && slug !== undefined && new RegExp(`^${slug}\\s+repo$`, "m").test(listed.out),
    `exit ${listed.code}: ${listed.out.trim()}`,
  );

  const server = Bun.spawn([bin, "--no-browser", "--port", String(PORT)], {
    env,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });
  const serverOut = { text: "" };
  const serverErr = { text: "" };
  const drained = Promise.all([collect(server.stdout, serverOut), collect(server.stderr, serverErr)]);
  const listening = `listening on http://127.0.0.1:${PORT}`;
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (!serverOut.text.includes(listening) && server.exitCode === null && Date.now() < deadline) await sleep(100);
  const up = serverOut.text.includes(listening);
  check(`serve --port ${PORT}`, up, up ? `127.0.0.1:${PORT}` : `no '${listening}' line: ${serverOut.text.trim()}`);

  if (up) {
    const base = `http://127.0.0.1:${PORT}`;
    const request = async (method: string, path: string, body?: string): Promise<{ status: number; text: string; error?: string }> => {
      try {
        const res = await fetch(`${base}${path}`, {
          method,
          body,
          headers: body === undefined ? undefined : { "Content-Type": "application/json" },
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
        return { status: res.status, text: method === "HEAD" ? "" : await res.text() };
      } catch (error) {
        return { status: 0, text: "", error: error instanceof Error ? error.message : String(error) };
      }
    };
    const expect = async (method: string, path: string, page: boolean, body?: string): Promise<string> => {
      const res = await request(method, path, body);
      const ok = page ? res.status === 200 : isAnswered(res.status);
      const detail = res.status === 0 ? `connection error: ${res.error ?? "?"}` : `status ${res.status}`;
      check(`${method} ${path}`, ok, detail);
      return res.text;
    };

    const index = await expect("GET", "/", true);
    await expect("HEAD", "/", true);
    const js = /main-[A-Za-z0-9_-]+\.js/.exec(index)?.[0];
    if (js === undefined) check("index names a main-*.js", false, "no main-*.js in /");
    else await expect("GET", `/${js}`, true);
    await expect("GET", `/w/${slug ?? "repo"}`, true);
    await expect("GET", "/api/settings", false);
    await expect("PUT", "/api/settings", false, JSON.stringify({ theme: "dark" }));
    await expect("GET", "/api/workspaces", false);
  }

  server.kill("SIGTERM");
  const code = await Promise.race([server.exited, sleep(STOP_TIMEOUT_MS).then(() => undefined)]);
  if (code === undefined) server.kill("SIGKILL");
  check("server stops on SIGTERM", code === 0, code === undefined ? "still running after 5 s, killed" : `exit ${code}`);
  await Promise.race([drained, sleep(1_000)]);
  stderr += serverErr.text;

  // A late lookup (a retry, a background timer) still counts: give it a moment before the tally.
  await sleep(500);
  trap.close();
  check(
    "no DNS query",
    queries.length === 0,
    queries.length === 0 ? "none reached the trap" : `${queries.length} reached the trap: ${queries.join(", ")}`,
  );
  const hits = outboundHits(stderr);
  check("no outbound error in stderr", hits.length === 0, hits.length === 0 ? "clean" : hits.join(" / "));
  if (stderr.trim() !== "") console.log(`----- spectant stderr -----\n${stderr.trim()}\n---------------------------`);
  return failures.length > 0 ? EXIT_FAILED : EXIT_PASSED;
}

// ---------------------------------------------------------------------------------------------------------------
// Host side
// ---------------------------------------------------------------------------------------------------------------

class RunError extends Error {
  constructor(
    message: string,
    readonly output = "",
  ) {
    super(message);
  }
}

type Result = { code: number; out: string; timedOut: boolean };

/** Runs a command from the repository root, stdout and stderr together; kills it after `timeoutMs`. */
async function exec(cmd: string[], timeoutMs: number, onTimeout?: () => void): Promise<Result> {
  const proc = Bun.spawn(cmd, { cwd: ROOT, stdout: "pipe", stderr: "pipe", stdin: "ignore" });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    onTimeout?.();
    proc.kill();
  }, timeoutMs);
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  clearTimeout(timer);
  return { code, out: stdout + stderr, timedOut };
}

async function dockerAvailable(): Promise<boolean> {
  try {
    return (await exec(["docker", "version", "--format", "{{.Server.Version}}"], 30_000)).code === 0;
  } catch {
    return false; // no docker executable at all
  }
}

async function ensureBinary(target: Platform["target"]): Promise<string> {
  const binary = `dist/spectant-${target}`;
  if (existsSync(join(ROOT, binary))) {
    console.log(`reusing ${binary} (run \`bun run build\` first to test a fresh build)`);
    return binary;
  }
  const skipWeb = existsSync(join(ROOT, "web", "dist", "browser", "index.html")) ? ["--skip-web"] : [];
  console.log(`${binary} is missing; building it`);
  const proc = Bun.spawn([process.execPath, "scripts/build.ts", ...skipWeb, "--targets", target], {
    cwd: ROOT,
    stdout: "inherit",
    stderr: "inherit",
    stdin: "ignore",
  });
  const code = await proc.exited;
  if (code !== 0) throw new RunError(`building ${binary} failed (exit ${code}); try \`bun run build\``);
  if (!existsSync(join(ROOT, binary))) throw new RunError(`the build reported success but wrote no ${binary}`);
  return binary;
}

function printTable(checks: Check[]): void {
  const width = Math.max(...checks.map((check) => check.name.length), 5);
  console.log(`\n  ${"check".padEnd(width)}  result  detail`);
  for (const check of checks) {
    console.log(`  ${check.name.padEnd(width)}  ${(check.ok ? "ok" : "FAIL").padEnd(6)}  ${check.detail}`);
  }
}

async function host(flag: DockerPlatform | undefined): Promise<number> {
  if (!(await dockerAvailable())) {
    console.error("test:offline:server: SKIPPED — docker not available (`docker version` failed); this is not a pass");
    return EXIT_SKIPPED;
  }
  const platform = resolvePlatform(flag, process.env, process.arch);
  const binary = await ensureBinary(platform.target);

  const scratch = mkdtempSync(join(tmpdir(), "spectant-offline-"));
  try {
    const data = join(scratch, "data");
    const resolvConf = join(scratch, "resolv.conf");
    // Every name lookup goes to the session's trap on loopback, never to a real resolver.
    writeFileSync(resolvConf, "nameserver 127.0.0.1\noptions timeout:1 attempts:1\n");
    mkdirSync(data);

    const inBox = `/opt/spectant/spectant-${platform.target}`;
    const name = `spectant-offline-${String(process.pid)}`;
    const cmd = [
      "docker", "run", "--rm", "--name", name,
      "--network", "none",
      "--platform", platform.docker,
      "-v", `${join(ROOT, "dist")}:/opt/spectant:ro`,
      "-v", `${join(ROOT, FIXTURE)}:/repo:ro`,
      "-v", `${data}:/data`,
      "-v", `${join(ROOT, "tests", "offline-server.ts")}:/harness/offline-server.ts:ro`,
      "-v", `${resolvConf}:/etc/resolv.conf:ro`,
      "-e", "BUN_BE_BUN=1",
      "-e", `SPECTANT_BIN=${inBox}`,
      IMAGES[platform.docker],
      inBox, "/harness/offline-server.ts", "--session",
    ];
    console.log(`running ${binary} in ubuntu:24.04 (${platform.docker}, pinned by digest, --network none)`);
    const run = await exec(cmd, RUN_TIMEOUT_MS, () => {
      Bun.spawnSync(["docker", "rm", "-f", name], { stdout: "ignore", stderr: "ignore" });
    });

    const checks = parseChecks(run.out);
    if (checks.length > 0) printTable(checks);
    const failed = run.timedOut || run.code !== 0 || checks.length === 0 || checks.some((check) => !check.ok);
    if (failed) {
      const why = run.timedOut ? "timed out after 3 min" : `exit ${run.code}`;
      console.error(`\ntest:offline:server: FAILED (${why}); container output:\n${run.out}`);
      return EXIT_FAILED;
    }
    console.log(`\ntest:offline:server: ${checks.length} checks passed on ${platform.docker}, 0 DNS queries, 0 outbound errors`);
    return EXIT_PASSED;
  } finally {
    try {
      rmSync(scratch, { recursive: true, force: true });
    } catch {
      console.error("test:offline:server: could not remove the temporary data directory (files owned by the container's root)");
    }
  }
}

async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  if (args.mode === "help") {
    console.log(USAGE);
    return EXIT_PASSED;
  }
  if (args.mode === "session") return session();
  return host(args.platform);
}

if (import.meta.main) {
  try {
    process.exit(await main(process.argv.slice(2)));
  } catch (error) {
    if (!(error instanceof RunError) && !(error instanceof UsageError)) throw error;
    const output = error instanceof RunError && error.output ? `\n${error.output}` : "";
    console.error(`test:offline:server: ${error.message}${output}`);
    process.exit(EXIT_FAILED);
  }
}
