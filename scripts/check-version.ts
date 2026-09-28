#!/usr/bin/env bun
/**
 * check-version — ISC-9: the host binary's `--version` prints the version in `package.json`.
 *
 * Usage: bun run check:version
 *
 * Checks, in order:
 *  1. one version for the product: the root `package.json` and `web/package.json` carry the same `version`;
 *  2. the host binary `dist/spectant-<os>-<arch>` exists. When it is missing and `web/dist/browser` is there, it is
 *     built with `bun scripts/build.ts --host-only --skip-web`; without a web build it fails with a hint to run
 *     `bun run build` (the Angular build needs a real Node, which this check does not assume);
 *  3. the binary, run with `--version` from a temporary directory (so nothing beside it can supply a version),
 *     exits 0 and writes exactly `spectant <version>\n` to stdout, the version being the one inlined at build time
 *     through `--define SPECTANT_VERSION` (T11).
 *
 * Why: a compiled binary has no `package.json` beside it; a stale binary or a broken `--define` would report a
 * version nobody released, and `install.sh` and bug reports trust that line.
 *
 * Output: `check:version: ok <version>` on stdout and exit 0; otherwise one `check:version: …` line per mismatch on
 * stderr and exit 1. Paths are repository-relative.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const WEB_BUILD = "web/dist/browser";
const BINARY_TIMEOUT_MS = 10_000;

class CheckError extends Error {}

function readVersion(file: string): string {
  const pkg: unknown = JSON.parse(readFileSync(join(ROOT, file), "utf8"));
  const version = typeof pkg === "object" && pkg !== null && "version" in pkg ? pkg.version : undefined;
  if (typeof version !== "string" || version === "") throw new CheckError(`${file} has no version string`);
  return version;
}

function hostBinary(): string {
  const os = process.platform === "darwin" || process.platform === "linux" ? process.platform : undefined;
  const arch = process.arch === "arm64" || process.arch === "x64" ? process.arch : undefined;
  if (os === undefined || arch === undefined) {
    throw new CheckError(`no release target for this host (${process.platform}-${process.arch})`);
  }
  return `dist/spectant-${os}-${arch}`;
}

async function ensureBinary(binary: string): Promise<void> {
  if (existsSync(join(ROOT, binary))) return;
  if (!existsSync(join(ROOT, WEB_BUILD))) {
    throw new CheckError(`${binary} is missing and there is no ${WEB_BUILD} to embed; run \`bun run build\` first`);
  }
  console.log(`check:version: ${binary} is missing; building it (bun scripts/build.ts --host-only --skip-web)`);
  const proc = Bun.spawn([process.execPath, "scripts/build.ts", "--host-only", "--skip-web"], {
    cwd: ROOT,
    stdout: "inherit",
    stderr: "inherit",
    stdin: "ignore",
  });
  const code = await proc.exited;
  if (code !== 0 || !existsSync(join(ROOT, binary))) {
    throw new CheckError(`building ${binary} failed (exit ${code}); run \`bun run build\` and retry`);
  }
}

/** Runs the binary with `--version` from an empty temp dir and returns the mismatches against `expected`. */
function probeBinary(binary: string, expected: string): string[] {
  const cwd = mkdtempSync(join(tmpdir(), "spectant-check-version-"));
  try {
    const result = Bun.spawnSync([join(ROOT, binary), "--version"], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
      timeout: BINARY_TIMEOUT_MS,
    });
    const stdout = result.stdout.toString();
    const stderr = result.stderr.toString().trim();
    const want = `spectant ${expected}\n`;
    const problems: string[] = [];
    if (result.exitedDueToTimeout) {
      problems.push(`${binary} --version did not exit within ${BINARY_TIMEOUT_MS / 1000} s (is --version ignored?)`);
    } else if (result.exitCode !== 0) {
      problems.push(`${binary} --version exited ${result.exitCode}${stderr ? `: ${stderr}` : ""}`);
    }
    if (stdout !== want) {
      problems.push(
        `${binary} --version printed ${JSON.stringify(stdout)}, expected ${JSON.stringify(want)}` +
          " (stale binary? rebuild with `bun run build`)",
      );
    }
    return problems;
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

async function main(): Promise<number> {
  const version = readVersion("package.json");
  const problems: string[] = [];
  const webVersion = readVersion("web/package.json");
  if (webVersion !== version) {
    problems.push(`web/package.json version ${webVersion} differs from package.json version ${version}`);
  }
  const binary = hostBinary();
  await ensureBinary(binary);
  problems.push(...probeBinary(binary, version));
  if (problems.length > 0) {
    for (const problem of problems) console.error(`check:version: ${problem}`);
    return 1;
  }
  console.log(`check:version: ok ${version}`);
  return 0;
}

if (import.meta.main) {
  try {
    process.exit(await main());
  } catch (error) {
    if (!(error instanceof CheckError)) throw error;
    console.error(`check:version: ${error.message}`);
    process.exit(1);
  }
}
