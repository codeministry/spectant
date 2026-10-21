// check-architecture (spec 059, ISC-415, ISC-413, ISC-414): the guard runs as the CLI over fixture configurations.
// The oversize fixture is red on `size` and names only its 401-line file, the clone fixture is red on `duplicates`
// and names the copied block, a configuration with both lanes checks both from their entries alone, a clean root is
// green, and a bad flag is a usage error.
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

  test("bad flag: exit 2", () => {
    const run = guard("--bogus");
    expect(run.exit).toBe(2);
    expect(run.stderr).toContain("unknown arguments: --bogus");
  });
});
