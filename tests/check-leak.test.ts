// check:leak (T54, ISC-3): the generic leak classes, the allow marker, the licence exemption (XC-10), the optional
// private word list, redaction, and one end-to-end run over a throwaway git repository.
//
// Every synthetic leak below carries a trailing `leak:allow` marker, so the repository scan stays clean while the
// strings still reach the scanner as plain values (the marker lives in this source, not in the scanned string).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { allowMarker, compileWords, parseWordList, redact, scanLine, scanText } from "../scripts/check-leak.ts";

const SCRIPT = join(import.meta.dir, "..", "scripts", "check-leak.ts");
const NO_WORDS = null;

function classes(line: string, path = "src/a.ts", words: RegExp | null = NO_WORDS): string[] {
  return scanLine(line, path, words).map((h) => h.cls);
}

describe("generic classes", () => {
  test("absolute home paths on macOS, Linux and Windows", () => {
    expect(classes("see /Users/jdoe/projects/x")).toEqual(["home-path"]); // leak:allow synthetic test input
    expect(classes("cd /home/jdoe/src")).toEqual(["home-path"]); // leak:allow synthetic test input
    expect(classes(String.raw`C:\Users\jdoe\repo`)).toEqual(["home-path"]); // leak:allow synthetic test input
    expect(classes(String.raw`"C:\\Users\\jdoe\\repo"`)).toEqual(["home-path"]); // leak:allow synthetic test input
  });

  test("placeholders and bare prefixes are not home paths", () => {
    expect(classes("/Users/<name>/ and /home/$USER/ and /home/runner/work")).toEqual([]);
    expect(classes("WORKDIR /home/tester")).toEqual([]);
    expect(classes(String.raw`as in C:\Users\NAME. and /home/runner.`)).toEqual([]);
    expect(classes('text.includes("/Users/")')).toEqual([]);
    expect(classes("https://example.org/home/jdoe/")).toEqual([]);
  });

  test("the house install path is a machine path", () => {
    expect(classes("bun ~/.claude/skills/Spec/Tools/SpecGate.ts")).toEqual(["machine-path"]); // leak:allow synthetic test input
    expect(classes("the LIFEOS/USER/ENGINEERING folder")).toEqual(["machine-path"]); // leak:allow synthetic test input
    expect(classes("~/.spectant/spectant.db")).toEqual([]);
  });

  test("email addresses, except noreply and reserved example domains", () => {
    expect(classes("mail jane.doe@acme-corp.de now")).toEqual(["email"]); // leak:allow synthetic test input
    expect(classes("noreply@github.com, no-reply@acme-corp.de")).toEqual([]);
    expect(classes("dev@example.com, a@b.test, x@y.invalid")).toEqual([]);
    expect(classes("git@github.com:org/repo.git and logo@2x.png and eslint@9.39.5")).toEqual([]);
  });

  test("IPv4 outside loopback, link-local, private and documentation ranges", () => {
    expect(classes("host 8.8.4.4 here")).toEqual(["ipv4"]); // leak:allow synthetic test input
    expect(classes("tailnet 100.101.102.103")).toEqual(["ipv4"]); // leak:allow synthetic test input
    const allowed = [
      "127.0.0.1", "127.4.5.6", "0.0.0.0", "10.0.0.5", "192.168.1.20", "172.16.0.1", "172.31.255.255",
      "169.254.1.1", "192.0.2.7", "198.51.100.7", "203.0.113.7", "255.255.255.0",
    ];
    for (const ip of allowed) expect(classes(`bind ${ip}.`)).toEqual([]);
    expect(classes("172.32.0.1")).toEqual(["ipv4"]); // leak:allow synthetic test input
    expect(classes("version 1.2.3.4.5 and 999.1.1.1")).toEqual([]);
  });

  test("phone numbers in E.164 form, packed or grouped", () => {
    expect(classes("call +4917012345678")).toEqual(["phone"]); // leak:allow synthetic test input
    expect(classes("call +49 170 1234567")).toEqual(["phone"]); // leak:allow synthetic test input
    expect(classes("a +1234 offset, 1+2345678")).toEqual([]);
  });

  test("IBANs with a valid checksum only", () => {
    expect(classes("DE89 3704 0044 0532 0130 00")).toEqual(["iban"]); // leak:allow synthetic test input (public sample)
    expect(classes("DE89370400440532013000")).toEqual(["iban"]); // leak:allow synthetic test input (public sample)
    expect(classes("DE88 3704 0044 0532 0130 00")).toEqual([]);
  });

  test("API-key-like secrets", () => {
    // The token shapes are assembled at runtime: a literal in the shape of a real key would trip the push gate of
    // the public repository even as synthetic test input.
    const lower = "abcdefghijklmnopqrstuvwxyz";
    const secrets = [
      `OPENAI=sk-${"proj"}-abcdEFGH1234ijklMNOP5678`, // leak:allow synthetic test input
      `ghp${"_"}${lower}0123456789`, // leak:allow synthetic test input
      `xoxb${"-"}1234567890-abcdefghij`, // leak:allow synthetic test input
      `AKIA${"ABCDEFGHIJKLMNOP"}`, // leak:allow synthetic test input
      'api_token = "0123456789abcdef0123456789abcdef"', // leak:allow synthetic test input
      "secret: 0123456789ABCDEF0123456789ABCDEF01", // leak:allow synthetic test input
    ];
    for (const line of secrets) expect(classes(line)).toEqual(["secret"]);
    expect(classes("commit 0123456789abcdef0123456789abcdef01234567")).toEqual([]);
    expect(classes("task-sk-list, sk-short")).toEqual([]);
  });

  test("a clean line has no hit", () => {
    expect(classes('serve on 127.0.0.1:4200 with `bun run dev`, see README.md')).toEqual([]);
  });
});

describe("redaction", () => {
  test("keeps the first three characters and an ellipsis", () => {
    expect(redact("jane.doe@acme-corp.de")).toBe("jan…"); // leak:allow synthetic test input
    expect(redact("ab")).toBe("ab…");
  });

  test("a reported hit never carries the full match", () => {
    const [hit] = scanLine("mail jane.doe@acme-corp.de", "a.md", NO_WORDS); // leak:allow synthetic test input
    expect(hit?.match).toBe("jane.doe@acme-corp.de"); // leak:allow synthetic test input
    const { hits } = scanText("a.md", "x\nmail jane.doe@acme-corp.de\n", NO_WORDS); // leak:allow synthetic test input
    expect(hits.map((h) => `${h.path}:${h.line}: ${h.cls}: ${redact(h.match)}`)).toEqual(["a.md:2: email: jan…"]);
  });
});

describe("allow marker", () => {
  test("html, slash and hash comment forms with a reason", () => {
    expect(allowMarker("| `~/.claude/x` | house | <!-- leak:allow house source path -->")?.reason).toBe("house source path"); // leak:allow synthetic test input
    expect(allowMarker("| a | b <!-- leak:allow table row --> |")?.reason).toBe("table row");
    expect(allowMarker('const a = "x"; // leak:allow detector pattern')?.reason).toBe("detector pattern");
    expect(allowMarker("WORKDIR /x # leak:allow container user")?.reason).toBe("container user");
    expect(allowMarker("no marker here")).toBeNull();
    expect(allowMarker("// leak:allow")?.reason).toBe("");
  });

  test("a marked line is skipped and counted, with its reason", () => {
    const text = "see /Users/jdoe/x // leak:allow fixture path\n"; // leak:allow synthetic test input
    const { hits, allowed } = scanText("a.ts", text, NO_WORDS);
    expect(hits).toEqual([]);
    expect(allowed).toEqual([{ path: "a.ts", line: 1, reason: "fixture path" }]);
  });

  test("a marker without a reason suppresses nothing", () => {
    const { hits, allowed } = scanText("a.ts", "see /Users/jdoe/x // leak:allow\n", NO_WORDS); // leak:allow synthetic test input
    expect(allowed).toEqual([]);
    expect(hits.map((h) => h.cls)).toEqual(["home-path"]);
    expect(hits[0]?.note).toContain("no reason");
  });

  test("the marker never hides a private word", () => {
    const words = compileWords(["Acme"]);
    const { hits } = scanText("a.md", "for Acme <!-- leak:allow sample -->\n", words);
    expect(hits.map((h) => h.cls)).toEqual(["private-word"]);
  });
});

describe("licence exemption (XC-10)", () => {
  const words = compileWords(["Jane Doe"]);
  const line = "Copyright 2026 Jane Doe <jane.doe@acme-corp.de>"; // leak:allow synthetic test input

  test("licence attributions may carry the holder's name and address", () => {
    for (const path of ["web/public/fonts/LICENSE-Inter.txt", "THIRD_PARTY_NOTICES.md", "core/fixtures/x/LICENSE-x.txt"]) {
      expect(scanLine(line, path, words)).toEqual([]);
    }
  });

  test("only from the name and email classes", () => {
    expect(scanLine("path /Users/jdoe/x", "LICENSE-x.txt", words).map((h) => h.cls)).toEqual(["home-path"]); // leak:allow synthetic test input
  });

  test("any other file is held to both", () => {
    expect(scanLine(line, "README.md", words).map((h) => h.cls).sort()).toEqual(["email", "private-word"]);
    expect(scanLine(line, "docs/LICENSE.md", words).map((h) => h.cls)).toEqual(["private-word"]);
  });
});

describe("private word list", () => {
  test("one word per line, comments and blanks ignored, trimmed", () => {
    expect(parseWordList("# customers\nAcme\n\n  Jane Doe  \n")).toEqual(["Acme", "Jane Doe"]);
  });

  test("matches whole words, case-insensitively", () => {
    const words = compileWords(["Acme", "jane doe"]);
    expect(classes("built for ACME today", "a.md", words)).toEqual(["private-word"]);
    expect(classes("by Jane  Doe", "a.md", words)).toEqual([]);
    expect(classes("by Jane Doe", "a.md", words)).toEqual(["private-word"]);
    expect(classes("acmeish and preacme and acme_x", "a.md", words)).toEqual([]);
    expect(classes("the acme-corp repo", "a.md", words)).toEqual(["private-word"]);
  });

  test("regex metacharacters in a word are literal", () => {
    const words = compileWords(["a.b (c)"]);
    expect(classes("x a.b (c) y", "a.md", words)).toEqual(["private-word"]);
    expect(classes("x aXb (c) y", "a.md", words)).toEqual([]);
  });

  test("an empty list compiles to nothing", () => {
    expect(compileWords([])).toBeNull();
  });
});

describe("run over a git repository", () => {
  let repo: string;
  let wordsFile: string;

  function git(...args: string[]): void {
    const r = Bun.spawnSync(["git", "-C", repo, ...args], { stdout: "pipe", stderr: "pipe" });
    if (r.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr.toString()}`);
  }

  function run(args: string[], env: Record<string, string | undefined> = {}): { code: number; out: string; err: string } {
    const merged: Record<string, string> = {};
    for (const [k, v] of Object.entries({ ...process.env, ...env })) if (v !== undefined) merged[k] = v;
    const r = Bun.spawnSync(["bun", SCRIPT, ...args], { env: merged, stdout: "pipe", stderr: "pipe" });
    return { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() };
  }

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), "spectant-leak-"));
    git("init", "-q");
    writeFileSync(join(repo, "README.md"), "# demo\n\nserve on 127.0.0.1:4200\n");
    writeFileSync(join(repo, "LICENSE-demo.txt"), "Copyright 2026 Jane Doe <jane.doe@acme-corp.de>\n"); // leak:allow synthetic test input
    writeFileSync(join(repo, "logo.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0x2f, 0x55]));
    writeFileSync(join(repo, "blob.dat"), "/Users/jdoe/\0binary"); // leak:allow synthetic test input
    git("add", "README.md", "LICENSE-demo.txt", "logo.png", "blob.dat");
    writeFileSync(join(repo, "untracked.md"), "see /Users/jdoe/secret\n"); // leak:allow synthetic test input
    wordsFile = join(repo, "..", `${repo.split("/").pop() ?? "x"}-words.txt`);
    writeFileSync(wordsFile, "# private\nJane Doe\nlantern\n");
  });

  afterAll(() => {
    rmSync(repo, { recursive: true, force: true });
    rmSync(wordsFile, { force: true });
  });

  test("a clean tracked tree exits 0; untracked files, binaries and licences are not findings", () => {
    const r = run([repo], { SPECTANT_LEAK_WORDS: undefined });
    expect(r.code).toBe(0);
    expect(r.out).toContain("private word list: none (SPECTANT_LEAK_WORDS unset)");
    expect(r.out).toMatch(/leak: 0 hits, 2 files scanned \(2 binary skipped, 0 lines allowed\)/);
    expect(r.err).toBe("");
  });

  test("one planted hit exits 1 with a redacted path:line report", () => {
    writeFileSync(join(repo, "notes.md"), "line one\nping 8.8.4.4 daily\n"); // leak:allow synthetic test input
    git("add", "notes.md");
    const r = run([repo], { SPECTANT_LEAK_WORDS: undefined });
    expect(r.code).toBe(1);
    expect(r.err).toContain("notes.md:2: ipv4: 8.8…");
    expect(r.err).not.toContain("8.8.4.4"); // leak:allow synthetic test input
    expect(r.err).toMatch(/leak: 1 hit, 3 files scanned/);
    git("rm", "-q", "--cached", "notes.md");
  });

  test("the private word list reports its hits and spares the licence", () => {
    writeFileSync(join(repo, "plan.md"), "for the Lantern team\n");
    git("add", "plan.md");
    const r = run([repo], { SPECTANT_LEAK_WORDS: wordsFile });
    expect(r.code).toBe(1);
    expect(r.out + r.err).toContain("private word list: 2 words (SPECTANT_LEAK_WORDS)");
    expect(r.err).toContain("plan.md:1: private-word: Lan…");
    expect(r.err).not.toContain("LICENSE-demo.txt");
    git("rm", "-q", "--cached", "plan.md");
  });

  test("usage errors exit 2", () => {
    expect(run([repo, "extra"]).code).toBe(2);
    expect(run(["--bogus"]).code).toBe(2);
    expect(run([join(repo, "does-not-exist")]).code).toBe(2);
    expect(run([repo], { SPECTANT_LEAK_WORDS: join(repo, "missing-words.txt") }).code).toBe(2);
  });

  test("--help prints usage and exits 0", () => {
    const r = run(["--help"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("Usage");
  });
});
