// The feature-level code-review mark through the CLI (spec 008, T93/T94, ISC-122.2): `spectant gate code-reviewed F6`
// on a temp copy of harbor turned into a repository of its own. Harbor's spike pair 008/009 is main feature F6 under
// `code_review: feature`; 008 is closed, 009 holds ISC-131 open. With ISC-131 closed (master and spec.md) the command
// marks both folders (`scope: F6`, one `code-review → close` event each) and both then derive `close`; with it open it
// refuses and writes nothing; without `--yes` it only prints. `bun test tests/gates.test.ts -t feature` runs them all.
import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { actorIdOf } from "../core/src/actor-id.ts";
import { validateEventLine } from "../core/src/events.ts";
import { readGateMark } from "../core/src/gates.ts";
import type { EmbeddedManifest } from "../server/src/assets.contract.ts";
import { run } from "../server/src/cli.ts";
import { loadDashboard } from "../server/src/workspace-loader.ts";
import { WRITE_PATHS } from "../server/src/writes.contract.ts";

const HARBOR = join(import.meta.dir, "..", "core", "fixtures", "harbor");
const F6 = ["008-referrers-support", "009-chunked-upload-limits"];
/** A synthetic address (reserved `.test` domain): the viewer of the copy. */
const VIEWER_EMAIL = "viewer@example.test";
/** `run` takes the embedded manifest; the gate subcommand never serves, so an empty one does. */
const MANIFEST: EmbeddedManifest = { generatedAt: "2026-10-12T00:00:00.000Z", index: "", assets: [] };

const root = mkdtempSync(join(tmpdir(), "spectant-feature-gate-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function gitIn(repo: string, ...args: string[]): string {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"].includes(key)));
  const result = Bun.spawnSync(["git", "-C", repo, ...args], { env, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr.toString()}`);
  return result.stdout.toString().trim();
}

/** Ticks ISC-131 in the master and in 009's spec.md: 009's last open claim closed. */
function close131(repo: string): void {
  for (const file of [join(repo, "ISA.md"), join(repo, "specs", F6[1] ?? "", "spec.md")]) {
    const text = readFileSync(file, "utf8");
    const ticked = text.replace("- [ ] ISC-131:", "- [x] ISC-131:"); // single-core: allow — test setup ticks one known line
    expect(ticked).not.toBe(text);
    writeFileSync(file, ticked);
  }
}

/**
 * A fresh copy of harbor. `git: true` makes it a repository of its own with one commit, a local viewer address and
 * `.gates/` excluded (a reviewer's local marks, as for every per-spec mark), so the worktree tree id is computable.
 */
function harbor(options: { closed: boolean; git: boolean }): string {
  const repo = join(mkdtempSync(join(root, "repo-")), "harbor");
  cpSync(HARBOR, repo, { recursive: true });
  if (options.closed) close131(repo);
  if (options.git) {
    gitIn(repo, "init", "--quiet", "--initial-branch=main");
    gitIn(repo, "config", "user.email", VIEWER_EMAIL);
    writeFileSync(join(repo, ".git", "info", "exclude"), "specs/*/.gates/\n");
    gitIn(repo, "add", "-A");
    gitIn(repo, "-c", "user.name=t", "commit", "--quiet", "-m", "harbor");
  }
  return repo;
}

/** Every file under `dir`, `.git/` included, to its sha256 (links to their target). */
function snapshot(dir: string, out = new Map<string, string>(), prefix = ""): Map<string, string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    const key = `${prefix}${entry.name}`;
    if (entry.isDirectory()) snapshot(path, out, `${key}/`);
    else if (entry.isSymbolicLink()) out.set(key, `link:${readlinkSync(path)}`);
    else out.set(key, createHash("sha256").update(readFileSync(path)).digest("hex"));
  }
  return out;
}

function changed(before: Map<string, string>, after: Map<string, string>): string[] {
  const keys = new Set([...before.keys(), ...after.keys()]);
  return [...keys].filter((k) => before.get(k) !== after.get(k)).sort();
}

const out: string[] = [];
const err: string[] = [];
const restore: Array<() => void> = [];
beforeEach(() => {
  out.length = 0;
  err.length = 0;
  const log = spyOn(console, "log").mockImplementation((...args: unknown[]) => void out.push(args.join(" ")));
  const error = spyOn(console, "error").mockImplementation((...args: unknown[]) => void err.push(args.join(" ")));
  restore.push(
    () => log.mockRestore(),
    () => error.mockRestore(),
  );
});
afterEach(() => {
  for (const undo of restore.splice(0)) undo();
});

async function stagesOf(repo: string): Promise<Record<string, string>> {
  const load = await loadDashboard(repo, null);
  if (!load.readable) throw new Error(`unreadable: ${load.error}`);
  return Object.fromEntries(load.model.specs.filter((r) => F6.includes(r.slug)).map((r) => [r.slug, `${r.stage}/${r.gates.codeReviewed.state}`]));
}

describe("ISC-122.2 the feature-level code-review mark: spectant gate code-reviewed F<n>", () => {
  test("feature F6 closed: --yes marks both folders with scope F6, one code-review → close event each, both derive close", async () => {
    const repo = harbor({ closed: true, git: true });
    expect(await stagesOf(repo)).toEqual({ [F6[0] ?? ""]: "code-review/missing", [F6[1] ?? ""]: "code-review/missing" });
    const before = snapshot(repo);
    const events = new Map(F6.map((f) => [f, readFileSync(join(repo, "specs", f, "events.jsonl"), "utf8")]));

    expect(await run(["gate", "code-reviewed", "F6", "--root", repo, "--yes"], MANIFEST)).toBe(0);
    expect(err).toEqual([]);

    // Exactly the fifth write path's files, per target folder, and nothing else (`.git/` included).
    const allowed = F6.flatMap((f) => WRITE_PATHS.codeReviewFeature.writes.map((p) => p.replace("specs/NNN-slug/", `specs/${f}/`))).sort();
    expect(changed(before, snapshot(repo))).toEqual(allowed);

    const head = gitIn(repo, "rev-parse", "HEAD");
    const marks = F6.map((f) => readFileSync(join(repo, "specs", f, ".gates", "code-reviewed.json"), "utf8"));
    expect(marks[1]).toBe(marks[0] ?? ""); // the same mark in every target folder
    const reading = readGateMark("code-reviewed", marks[0] ?? "");
    expect(reading.diagnostics).toEqual([]);
    expect(reading.mark).toMatchObject({ gate: "code-reviewed", scope: "F6", head, branch: "main", findings: { code: 0, security: 0 } });
    expect((JSON.parse(marks[0] ?? "{}") as { actor?: unknown }).actor).toBe(actorIdOf(VIEWER_EMAIL));

    for (const f of F6) {
      const text = readFileSync(join(repo, "specs", f, "events.jsonl"), "utf8");
      const old = events.get(f) ?? "";
      expect(text.startsWith(old)).toBe(true);
      const added = text.slice(old.length).split("\n").filter((l) => l !== "");
      expect(added).toHaveLength(1);
      const check = validateEventLine(added[0] ?? "");
      if (!check.ok) throw new Error(check.diagnostic.message);
      expect(check.event).toMatchObject({ from: "code-review", to: "close", command: "spectant gate code-reviewed F6", actor: actorIdOf(VIEWER_EMAIL) });
    }

    // The dashboard, built by core over the copy as it now is: the mark is fresh and both specs stand in close.
    expect(await stagesOf(repo)).toEqual({ [F6[0] ?? ""]: "close/fresh", [F6[1] ?? ""]: "close/fresh" });
    expect(out.join("\n")).toContain("wrote the mark (scope F6");
  });

  test("feature F6 with 009 open: refuses with exit 1, names 009 and ISC-131, and writes nothing", async () => {
    const repo = harbor({ closed: false, git: true });
    const before = snapshot(repo);
    expect(await run(["gate", "code-reviewed", "F6", "--root", repo, "--yes"], MANIFEST)).toBe(1);
    expect(changed(before, snapshot(repo))).toEqual([]);
    expect(out).toEqual([]);
    expect(err.join("\n")).toContain("F6 still has open claims: 009-chunked-upload-limits (open claim ISC-131)");
  });

  test("feature F6 without --yes: prints what it would write, exits 0, and writes nothing", async () => {
    const repo = harbor({ closed: true, git: true });
    const before = snapshot(repo);
    expect(await run(["gate", "code-reviewed", "F6", "--root", repo], MANIFEST)).toBe(0);
    expect(changed(before, snapshot(repo))).toEqual([]);
    expect(err).toEqual([]);
    const printed = out.join("\n");
    expect(printed).toContain("would write the mark (scope F6");
    for (const f of F6) expect(printed).toContain(`specs/${f}/.gates/code-reviewed.json · code-review → close in specs/${f}/events.jsonl`);
    expect(printed).toContain("run it again with --yes");
  });

  test("feature gate refuses without a computable tree id, for an unknown feature, and parses usage errors", async () => {
    const plain = harbor({ closed: true, git: false });
    const before = snapshot(plain);
    expect(await run(["gate", "code-reviewed", "F6", "--root", plain, "--yes"], MANIFEST)).toBe(1);
    expect(err.join("\n")).toContain("tree id cannot be computed");
    expect(await run(["gate", "code-reviewed", "F99", "--root", plain, "--yes"], MANIFEST)).toBe(1);
    expect(err.join("\n")).toContain("F99 is not a feature block of the master");
    expect(changed(before, snapshot(plain))).toEqual([]);
    expect(await run(["gate", "code-reviewed", "6", "--root", plain], MANIFEST)).toBe(2);
    expect(await run(["gate", "reviewed", "F6"], MANIFEST)).toBe(2);
    expect(await run(["list", "--root", plain], MANIFEST)).toBe(2);
  });
});
