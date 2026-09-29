// The server's bind address (T49, ISC-1: loopback only). Three angles on one claim: the socket the kernel reports,
// a connect attempt on every non-loopback IPv4 of this machine, and a source guard over the two files that decide
// where the server listens. The `--port` range check is ISC-8's and lives in `tests/cli.test.ts`
// ("a missing or malformed --port value returns 2"); it is not repeated here.
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createConnection } from "node:net";
import { networkInterfaces, tmpdir } from "node:os";
import { join } from "node:path";
import type { EmbeddedManifest } from "../server/src/assets.contract.ts";
import { LOOPBACK_HOST, serve } from "../server/src/http.ts";

/** The only addresses ISC-1 allows the server to listen on. */
const LOOPBACK_ADDRESSES = ["127.0.0.1", "::1"];
const CONNECT_TIMEOUT_MS = 500;
const SERVER_SOURCES = ["server/src/http.ts", "server/src/cli.ts"];
const REPO_ROOT = join(import.meta.dir, "..");

let dir: string;
let manifest: EmbeddedManifest;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "spectant-server-"));
  const index = join(dir, "index.html");
  writeFileSync(index, "<!doctype html><title>spectant</title>");
  manifest = { generatedAt: "2026-09-29T00:00:00.000Z", assets: [], index };
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

const running: Array<{ stop(): void }> = [];
afterEach(() => {
  for (const server of running.splice(0)) server.stop();
});

function start() {
  const server = serve({ manifest, port: 0 });
  running.push(server);
  return server;
}

/** Bytes of a `/proc/net/tcp{,6}` address: the kernel prints each 32-bit word in host (little-endian) order. */
function procBytes(hex: string): number[] {
  const bytes: number[] = [];
  for (let word = 0; word < hex.length; word += 8) {
    const chunk = hex.slice(word, word + 8);
    for (let i = 6; i >= 0; i -= 2) bytes.push(Number.parseInt(chunk.slice(i, i + 2), 16));
  }
  return bytes;
}

function formatAddress(bytes: number[]): string {
  if (bytes.length === 4) return bytes.join(".");
  if (bytes.every((b, i) => b === (i === 15 ? 1 : 0))) return "::1";
  if (bytes.every((b) => b === 0)) return "::";
  const groups: string[] = [];
  for (let i = 0; i < 16; i += 2) groups.push((((bytes[i] ?? 0) << 8) | (bytes[i + 1] ?? 0)).toString(16));
  return groups.join(":");
}

/**
 * The local addresses this process listens on at `port`, as the kernel reports them: `lsof` where it exists
 * (macOS always, Linux usually), `/proc/net/tcp{,6}` otherwise. `null` when neither is available.
 */
function listenAddresses(port: number): string[] | null {
  if (Bun.which("lsof") !== null) {
    const result = Bun.spawnSync(["lsof", "-nP", "-a", "-p", String(process.pid), `-iTCP:${port}`, "-sTCP:LISTEN"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    return [...result.stdout.toString().matchAll(/TCP (\S+):(\d+) \(LISTEN\)/g)]
      .filter((m) => Number(m[2]) === port)
      .map((m) => (m[1] ?? "").replace(/^\[(.*)\]$/, "$1"));
  }
  const tables = ["/proc/net/tcp", "/proc/net/tcp6"].filter((file) => existsSync(file));
  if (tables.length === 0) return null;
  const addresses: string[] = [];
  for (const table of tables) {
    for (const line of readFileSync(table, "utf8").split("\n").slice(1)) {
      const [, local, , state] = line.trim().split(/\s+/);
      if (!local || state !== "0A") continue; // 0A = TCP_LISTEN
      const [hex = "", portHex = ""] = local.split(":");
      if (Number.parseInt(portHex, 16) === port) addresses.push(formatAddress(procBytes(hex)));
    }
  }
  return addresses;
}

/** Every IPv4 address of this machine outside 127.0.0.0/8. */
function nonLoopbackIpv4(): string[] {
  return Object.values(networkInterfaces())
    .flatMap((infos) => infos ?? [])
    .filter((info) => (info.family === "IPv4" || (info.family as unknown) === 4) && !info.address.startsWith("127."))
    .map((info) => info.address);
}

/** Opens a TCP connection and reports how it ended: `connected`, an error code, or `timeout`. */
function tryConnect(host: string, port: number): Promise<string> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port });
    const finish = (outcome: string) => {
      clearTimeout(timer);
      socket.destroy();
      resolve(outcome);
    };
    const timer = setTimeout(() => finish("timeout"), CONNECT_TIMEOUT_MS);
    socket.once("connect", () => finish("connected"));
    socket.once("error", (error: NodeJS.ErrnoException) => finish(error.code ?? error.message));
  });
}

/** Strips block and line comments, leaving `://` in URLs alone, so the guard reads code and not prose about it. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** The argument text of every `Bun.serve(...)` call, up to its balanced closing parenthesis. */
function bunServeArguments(source: string): string[] {
  const calls: string[] = [];
  for (const match of source.matchAll(/Bun\.serve\s*\(/g)) {
    let depth = 1;
    let i = match.index + match[0].length;
    const begin = i;
    for (; i < source.length && depth > 0; i++) {
      if (source[i] === "(") depth++;
      else if (source[i] === ")") depth--;
    }
    calls.push(source.slice(begin, i - 1));
  }
  return calls;
}

/** A hostname expression the guard accepts: the `LOOPBACK_HOST` constant or a loopback literal. */
const LOOPBACK_EXPRESSION = /^(LOOPBACK_HOST|(["'`])(127\.0\.0\.1|::1)\2)$/;

describe("loopback", () => {
  test("serve binds the loopback host and the socket the kernel reports is 127.0.0.1 or ::1", () => {
    expect(LOOPBACK_ADDRESSES).toContain(LOOPBACK_HOST);
    const server = start();
    expect(server.port).toBeGreaterThan(0);
    const host = LOOPBACK_HOST.includes(":") ? `[${LOOPBACK_HOST}]` : LOOPBACK_HOST;
    expect(server.url).toBe(`http://${host}:${server.port}/`);

    const addresses = listenAddresses(server.port);
    if (addresses === null) {
      console.warn("loopback: neither lsof nor /proc/net/tcp is available; the socket address is not inspected");
      return;
    }
    expect(addresses.length).toBeGreaterThan(0);
    for (const address of addresses) expect(LOOPBACK_ADDRESSES).toContain(address);
  });

  test("the loopback url answers, so a refused connect elsewhere is not a dead server", async () => {
    const server = start();
    const res = await fetch(server.url);
    expect(res.status).toBe(200);
    await res.arrayBuffer();
  });

  test(
    "every non-loopback IPv4 of this machine refuses a connect to the server's port within 500 ms",
    async () => {
      const addresses = nonLoopbackIpv4();
      if (addresses.length === 0) {
        console.warn("loopback: this machine has no non-loopback IPv4 address; the refused-connect probe is skipped");
        return;
      }
      const server = start();
      const outcomes = await Promise.all(addresses.map(async (address) => [address, await tryConnect(address, server.port)]));
      expect(Object.fromEntries(outcomes)).toEqual(Object.fromEntries(addresses.map((a) => [a, "ECONNREFUSED"])));
    },
    CONNECT_TIMEOUT_MS * 4,
  );

  test("guard: http.ts and cli.ts name no wildcard bind and every Bun.serve( sets a loopback hostname", () => {
    for (const rel of SERVER_SOURCES) {
      const source = code(readFileSync(join(REPO_ROOT, rel), "utf8"));
      expect({ rel, wildcardV4: source.includes("0.0.0.0") }).toEqual({ rel, wildcardV4: false });
      expect({ rel, wildcardV6: /(["'`])::\1|\[::\]/.test(source) }).toEqual({ rel, wildcardV6: false });
      expect({ rel, undefinedHost: /hostname\s*:\s*(undefined|null|["'`]{2})/.test(source) }).toEqual({
        rel,
        undefinedHost: false,
      });
      for (const [, raw = ""] of source.matchAll(/hostname\s*:\s*([^,}\n]+)/g)) {
        const hostname = raw.trim();
        expect({ rel, hostname, loopback: LOOPBACK_EXPRESSION.test(hostname) }).toEqual({ rel, hostname, loopback: true });
      }
      for (const args of bunServeArguments(source)) {
        expect({ rel, explicitHostname: /hostname\s*:/.test(args) }).toEqual({ rel, explicitHostname: true });
      }
      const constant = /LOOPBACK_HOST\s*=\s*(["'`])([^"'`]*)\1/.exec(source);
      if (constant) expect(LOOPBACK_ADDRESSES).toContain(constant[2] ?? "");
    }
    // http.ts is where the server starts; the guard is empty if it ever stops calling Bun.serve there.
    expect(bunServeArguments(code(readFileSync(join(REPO_ROOT, "server/src/http.ts"), "utf8")))).toHaveLength(1);
  });
});
