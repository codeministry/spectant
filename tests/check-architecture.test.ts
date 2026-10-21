// check-architecture (spec 059, ISC-415, ISC-413, ISC-414): the guard runs as the CLI over fixture configurations.
// The oversize fixture is red on `size` and names only its 401-line file, the clone fixture is red on `duplicates`
// and names the copied block (and is green when a `duplicates.allow` entry names its two files), a configuration
// with both lanes checks both from their entries alone, a clean root is green, and a bad flag is a usage error. The web fixtures (spec 060, ISC-423) run the web entry of
// `scripts/architecture/web.entry.ts` over a fixture root: a 401-line stylesheet and a block copied between two
// templates are red, the same files under `features/` are ignored, and a clean template and stylesheet are green.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..");
const SCRIPT = join(REPO_ROOT, "scripts", "check-architecture.ts");
const FIXTURES = "tests/fixtures/architecture";

type Run = { exit: number; stdout: string; stderr: string };

function guard(...args: string[]): Run {
  const run = Bun.spawnSync(["bun", SCRIPT, ...args], { cwd: REPO_ROOT, stdout: "pipe", stderr: "pipe" });
  return { exit: run.exitCode, stdout: run.stdout.toString(), stderr: run.stderr.toString() };
}

/** The violation lines of a run: stderr without the summary. */
function violations(run: Run): string[] {
  return run.stderr.split("\n").filter((line) => line !== "" && !line.startsWith("architecture:"));
}

const OVERSIZE_LINE = `size ${FIXTURES}/oversize/src/over-limit.ts 401 lines, limit 400`;
const CLONE_LINE =
  `duplicates ${FIXTURES}/clone/src/nested/copy.ts:4-17 = ${FIXTURES}/clone/src/original.ts:4-17 (154 tokens)`;

const WEB = `${FIXTURES}/web/red/src`;
const WEB_LINES = [
  `size ${WEB}/shared/wide.css 401 lines, limit 400`,
  `duplicates ${WEB}/layout/footer.html:1-11 = ${WEB}/layout/header.html:2-12 (147 tokens)`,
];

describe("check-architecture", () => {
  test("oversize fixture: exit 1, only the 401-line file", () => {
    const run = guard("--config", `${FIXTURES}/oversize/architecture.config.ts`);
    expect(run.exit).toBe(1);
    expect(violations(run)).toEqual([OVERSIZE_LINE]);
    expect(run.stderr).toContain("architecture: 1 violations, 1 entries (fixture-oversize)");
  });

  test("clone fixture: exit 1, the copied block", () => {
    const run = guard("--config", `${FIXTURES}/clone/architecture.config.ts`);
    expect(run.exit).toBe(1);
    expect(violations(run)).toEqual([CLONE_LINE]);
    expect(run.stderr).toContain("architecture: 1 violations, 1 entries (fixture-clone)");
  });

  test("a named duplicates exception: the allowed pair is not reported, the same clone without it is", () => {
    const allowed = guard("--config", `${FIXTURES}/clone/allowed.config.ts`);
    expect(allowed.exit).toBe(0);
    expect(allowed.stderr).toBe("");
    expect(allowed.stdout).toContain("architecture: 0 violations, 1 entries (fixture-clone-allowed)");
    const plain = guard("--config", `${FIXTURES}/clone/architecture.config.ts`);
    expect(plain.exit).toBe(1);
    expect(violations(plain)).toEqual([CLONE_LINE]);
  });

  test("a second lane entry with its own root is checked without a change to the guard", () => {
    const run = guard("--config", `${FIXTURES}/two-lanes.config.ts`);
    expect(run.exit).toBe(1);
    expect(violations(run)).toEqual([OVERSIZE_LINE, CLONE_LINE]);
    expect(run.stderr).toContain("architecture: 2 violations, 2 entries (fixture-oversize, fixture-clone)");
  });

  test("clean fixture: exit 0", () => {
    const run = guard("--config", `${FIXTURES}/clean/architecture.config.ts`);
    expect(run.exit).toBe(0);
    expect(run.stderr).toBe("");
    expect(run.stdout).toContain("architecture: 0 violations, 1 entries (fixture-clean)");
  });

  test("web fixture: exit 1, the 401-line stylesheet and the block copied between two templates", () => {
    const run = guard("--config", `${FIXTURES}/web/red/architecture.config.ts`);
    expect(run.exit).toBe(1);
    expect(violations(run)).toEqual(WEB_LINES);
    expect(run.stderr).toContain("architecture: 2 violations, 1 entries (fixture-web-red)");
  });

  test("clean web fixture: a component with its template and stylesheet in files of their own, exit 0", () => {
    const run = guard("--config", `${FIXTURES}/web/clean/architecture.config.ts`);
    expect(run.exit).toBe(0);
    expect(run.stderr).toBe("");
    expect(run.stdout).toContain("architecture: 0 violations, 1 entries (fixture-web-clean)");
  });

  test("bad flag: exit 2", () => {
    const run = guard("--bogus");
    expect(run.exit).toBe(2);
    expect(run.stderr).toContain("unknown arguments: --bogus");
  });
});
