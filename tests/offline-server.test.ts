/**
 * The pure parts of `tests/offline-server.ts` (T53, ISC-2): argument handling, platform choice, the stderr grep for
 * outbound attempts, the status verdict and the parsing of the container's check lines. The Docker run itself is
 * `bun run test:offline:server`; nothing here needs Docker, so the lane probe `bun test tests/` stays green without it.
 */
import { describe, expect, test } from "bun:test";
import {
  dnsQueryName,
  EXIT_SKIPPED,
  IMAGES,
  isAnswered,
  outboundHits,
  parseArgs,
  parseChecks,
  resolvePlatform,
  upInterfaces,
  UsageError,
} from "./offline-server.ts";

describe("parseArgs", () => {
  test("no arguments runs the host orchestration with no platform override", () => {
    expect(parseArgs([])).toEqual({ mode: "host", platform: undefined });
  });

  test("a bare `--` from `bun run … --` is ignored", () => {
    expect(parseArgs(["--"])).toEqual({ mode: "host", platform: undefined });
  });

  test("--platform takes a separate or an inline value", () => {
    expect(parseArgs(["--platform", "linux/amd64"])).toEqual({ mode: "host", platform: "linux/amd64" });
    expect(parseArgs(["--", "--platform=linux/arm64"])).toEqual({ mode: "host", platform: "linux/arm64" });
  });

  test("--platform refuses anything but linux/arm64 and linux/amd64", () => {
    expect(() => parseArgs(["--platform", "linux/riscv64"])).toThrow(UsageError);
    expect(() => parseArgs(["--platform"])).toThrow(UsageError);
  });

  test("--session selects the in-container session and takes nothing else", () => {
    expect(parseArgs(["--session"])).toEqual({ mode: "session" });
    expect(() => parseArgs(["--session", "--platform", "linux/arm64"])).toThrow(UsageError);
  });

  test("--help and -h select help", () => {
    expect(parseArgs(["--help"])).toEqual({ mode: "help" });
    expect(parseArgs(["-h"])).toEqual({ mode: "help" });
  });

  test("unknown options and positional arguments are usage errors", () => {
    expect(() => parseArgs(["--bogus"])).toThrow(UsageError);
    expect(() => parseArgs(["extra"])).toThrow(UsageError);
  });
});

describe("resolvePlatform", () => {
  test("the host architecture is the default: arm64 on Apple Silicon, amd64 on x64", () => {
    expect(resolvePlatform(undefined, {}, "arm64")).toEqual({ docker: "linux/arm64", target: "linux-arm64" });
    expect(resolvePlatform(undefined, {}, "x64")).toEqual({ docker: "linux/amd64", target: "linux-x64" });
  });

  test("E2E_PLATFORM (the container.ts override) beats the host architecture", () => {
    expect(resolvePlatform(undefined, { E2E_PLATFORM: "linux/amd64" }, "arm64")).toEqual({
      docker: "linux/amd64",
      target: "linux-x64",
    });
  });

  test("the --platform flag beats E2E_PLATFORM", () => {
    expect(resolvePlatform("linux/arm64", { E2E_PLATFORM: "linux/amd64" }, "x64")).toEqual({
      docker: "linux/arm64",
      target: "linux-arm64",
    });
  });

  test("an invalid E2E_PLATFORM or an unsupported host is a usage error", () => {
    expect(() => resolvePlatform(undefined, { E2E_PLATFORM: "windows/amd64" }, "arm64")).toThrow(UsageError);
    expect(() => resolvePlatform(undefined, {}, "ia32")).toThrow(UsageError);
  });
});

describe("outboundHits", () => {
  test("finds every line that names a DNS or outbound failure", () => {
    const stderr = [
      "spectant listening on http://127.0.0.1:7717",
      "error: getaddrinfo ENOTFOUND registry.example.com",
      "Error: getaddrinfo EAI_AGAIN fonts.googleapis.com",
      "connect ENETUNREACH 1.2.3.4:443",
      "connect EHOSTUNREACH 10.0.0.1:80",
      "TypeError: fetch failed",
      "error: Unable to connect. Is the computer able to access the url?",
      "FailedToOpenSocket: Was there a typo in the url or port?",
    ].join("\n");
    expect(outboundHits(stderr)).toEqual([
      "error: getaddrinfo ENOTFOUND registry.example.com",
      "Error: getaddrinfo EAI_AGAIN fonts.googleapis.com",
      "connect ENETUNREACH 1.2.3.4:443",
      "connect EHOSTUNREACH 10.0.0.1:80",
      "TypeError: fetch failed",
      "error: Unable to connect. Is the computer able to access the url?",
      "FailedToOpenSocket: Was there a typo in the url or port?",
    ]);
  });

  test("a clean log and ordinary server lines are not hits", () => {
    expect(outboundHits("")).toEqual([]);
    expect(outboundHits("spectant listening on http://127.0.0.1:7717\nadded repo · repo\n")).toEqual([]);
  });

  test("the match is case-insensitive for the prose messages", () => {
    expect(outboundHits("FETCH FAILED")).toEqual(["FETCH FAILED"]);
  });
});

describe("isAnswered", () => {
  test("200, 304 and any 4xx count as answered", () => {
    for (const status of [200, 304, 400, 404, 405]) expect(isAnswered(status)).toBe(true);
  });

  test("a connection error (0), a 5xx or an unexpected code does not", () => {
    for (const status of [0, 204, 301, 500, 503]) expect(isAnswered(status)).toBe(false);
  });
});

describe("upInterfaces", () => {
  test("keeps only interfaces whose sysfs flags carry IFF_UP (0x1)", () => {
    // What `--network none` shows under Docker Desktop: dormant tunnel devices beside a live loopback.
    expect(upInterfaces({ lo: "0x9", sit0: "0x80", gretap0: "0x1002", tunl0: "0x80" })).toEqual(["lo"]);
    expect(upInterfaces({ lo: "0x9", eth0: "0x1003\n" })).toEqual(["eth0", "lo"]);
  });
});

describe("dnsQueryName", () => {
  /** A minimal DNS query: 12-byte header, QNAME labels, QTYPE and QCLASS. */
  function query(name: string, qtype = 1): Uint8Array {
    const labels = name.split(".").flatMap((label) => [label.length, ...new TextEncoder().encode(label)]);
    return new Uint8Array([0x12, 0x34, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, ...labels, 0, 0, qtype, 0, 1]);
  }

  test("reads the question name and type of a query packet", () => {
    expect(dnsQueryName(query("registry.example.com"))).toBe("registry.example.com A");
    expect(dnsQueryName(query("fonts.googleapis.com", 28))).toBe("fonts.googleapis.com AAAA");
  });

  test("a truncated or garbled packet is reported, never thrown", () => {
    expect(dnsQueryName(new Uint8Array([1, 2, 3]))).toBe("(unparsable packet, 3 bytes)");
    expect(dnsQueryName(new Uint8Array([0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 40, 97]))).toBe(
      "(unparsable packet, 14 bytes)",
    );
  });
});

describe("IMAGES", () => {
  test("every platform runs a digest-pinned ubuntu image", () => {
    for (const image of Object.values(IMAGES)) expect(image).toMatch(/^ubuntu@sha256:[0-9a-f]{64}$/);
    expect(Object.keys(IMAGES).sort()).toEqual(["linux/amd64", "linux/arm64"]);
  });
});

describe("parseChecks", () => {
  test("reads `CHECK|name|ok|detail` lines and ignores everything else", () => {
    const out = [
      "noise before",
      "CHECK|network none|ok|interfaces: lo",
      "CHECK|GET /|fail|status 0 (connection error)",
      "CHECK|detail with pipes|ok|a|b",
    ].join("\n");
    expect(parseChecks(out)).toEqual([
      { name: "network none", ok: true, detail: "interfaces: lo" },
      { name: "GET /", ok: false, detail: "status 0 (connection error)" },
      { name: "detail with pipes", ok: true, detail: "a|b" },
    ]);
  });
});

test("a skip without Docker exits 2, distinct from pass (0) and fail (1)", () => {
  expect(EXIT_SKIPPED).toBe(2);
});
