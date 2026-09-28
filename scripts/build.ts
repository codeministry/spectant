#!/usr/bin/env bun
/**
 * build — the four-target release build (T11, ISC-8; plan 001 § Approach "Embedding", § Risks).
 *
 * Usage: bun scripts/build.ts                     (web build, embed, compile all four targets)
 *        bun scripts/build.ts --skip-web          (reuse web/dist/browser; embed and compile only)
 *        bun scripts/build.ts --host-only         (compile only the target of this machine)
 *        bun scripts/build.ts --targets <list>    (comma-separated, e.g. `darwin-arm64,linux-x64`)
 *
 * Steps, each timed, each fatal on failure:
 *  1. the Angular build, `bun run --cwd web build`. The Angular CLI needs a real Node (>= 22.22.3); Bun's Node
 *     compatibility layer is refused by it, so a Node on PATH is checked up front (plan 001 § Risks, round 4);
 *  2. `bun scripts/embed.ts`, which writes `server/embedded.gen.ts` from the web output;
 *  3. `bun build --compile` of `server/src/main.ts` per target into `dist/spectant-<os>-<arch>`, with the root
 *     `package.json` version inlined through `--define SPECTANT_VERSION` (a binary has no package.json beside it);
 *  4. on macOS, an ad-hoc signature (`codesign -s -`) on each darwin binary, because an unsigned or badly signed
 *     arm64 binary is killed on launch; on Linux a notice that the darwin binaries still need signing on macOS;
 *  5. a table of the outputs with their sizes.
 *
 * Output paths and messages are repository-relative; nothing absolute is printed.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const DIST = "dist";
const ENTRY = "server/src/main.ts";
const MIN_NODE: readonly [number, number, number] = [22, 22, 3];

type Target = { name: string; bunTarget: string; os: "darwin" | "linux" };

const TARGETS: readonly Target[] = [
  { name: "darwin-arm64", bunTarget: "bun-darwin-arm64", os: "darwin" },
  { name: "darwin-x64", bunTarget: "bun-darwin-x64", os: "darwin" },
  { name: "linux-arm64", bunTarget: "bun-linux-arm64", os: "linux" },
  // Built from the `-baseline` runtime but published under the plain name: baseline needs no AVX2, so the binary
  // also runs on older x64 CPUs and under emulation (QEMU/Rosetta in the install container), where the default
  // x64 runtime dies with "Illegal instruction" (plan 001 § Risks).
  { name: "linux-x64", bunTarget: "bun-linux-x64-baseline", os: "linux" },
];

class BuildError extends Error {}

function hostTargetName(): string {
  const os = process.platform === "darwin" || process.platform === "linux" ? process.platform : undefined;
  const arch = process.arch === "arm64" || process.arch === "x64" ? process.arch : undefined;
  if (os === undefined || arch === undefined) {
    throw new BuildError(`no release target for this host (${process.platform}-${process.arch})`);
  }
  return `${os}-${arch}`;
}

type Options = { targets: Target[]; skipWeb: boolean };

function parseArgs(argv: string[]): Options {
  let names: string[] | undefined;
  let hostOnly = false;
  let skipWeb = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    if (arg === "--skip-web") skipWeb = true;
    else if (arg === "--host-only") hostOnly = true;
    else if (arg === "--targets" || arg.startsWith("--targets=")) {
      const value = arg === "--targets" ? argv[++i] : arg.slice("--targets=".length);
      if (!value) throw new BuildError("--targets needs a comma-separated list");
      names = value.split(",").map((name) => name.trim()).filter((name) => name !== "");
    } else {
      throw new BuildError(
        `unknown argument ${arg}; usage: bun scripts/build.ts [--skip-web] [--host-only | --targets <list>]`,
      );
    }
  }
  if (hostOnly && names !== undefined) throw new BuildError("--host-only and --targets exclude each other");
  if (hostOnly) names = [hostTargetName()];
  const valid = TARGETS.map((target) => target.name).join(", ");
  const targets = (names ?? TARGETS.map((target) => target.name)).map((name) => {
    const target = TARGETS.find((candidate) => candidate.name === name);
    if (!target) throw new BuildError(`unknown target ${JSON.stringify(name)}; valid targets: ${valid}`);
    return target;
  });
  if (targets.length === 0) throw new BuildError(`--targets is empty; valid targets: ${valid}`);
  return { targets, skipWeb };
}

/** Runs a command from the repository root with inherited output; throws a `BuildError` on a non-zero exit. */
async function exec(cmd: string[], what: string): Promise<void> {
  const proc = Bun.spawn(cmd, { cwd: ROOT, stdout: "inherit", stderr: "inherit", stdin: "ignore" });
  const code = await proc.exited;
  if (code !== 0) throw new BuildError(`${what} failed (exit ${code}): ${cmd.join(" ")}`);
}

/** Runs a command and returns its stdout, or `undefined` when it cannot start or exits non-zero. */
function capture(cmd: string[]): string | undefined {
  try {
    const result = Bun.spawnSync(cmd, { cwd: ROOT, stdout: "pipe", stderr: "ignore", stdin: "ignore" });
    return result.exitCode === 0 ? result.stdout.toString().trim() : undefined;
  } catch {
    return undefined;
  }
}

async function step(title: string, body: () => Promise<void>): Promise<void> {
  console.log(`\n▸ ${title}`);
  const started = performance.now();
  await body();
  console.log(`✓ ${title} (${((performance.now() - started) / 1000).toFixed(1)} s)`);
}

function atLeast(version: readonly number[], minimum: readonly number[]): boolean {
  for (let i = 0; i < minimum.length; i++) {
    const have = version[i] ?? 0;
    const need = minimum[i] ?? 0;
    if (have !== need) return have > need;
  }
  return true;
}

/** Fails early and readably when no real Node >= MIN_NODE is on PATH; the Angular CLI would fail late and cryptically. */
function checkNode(): void {
  const wanted = MIN_NODE.join(".");
  const hint = `the Angular CLI needs Node >= ${wanted} on PATH (web/package.json engines); install it beside bun, or pass --skip-web to reuse an existing web/dist/browser`;
  // `bun run` puts a `node` shim that is Bun itself on PATH when no Node is installed; the Angular CLI refuses it.
  const probe = capture(["node", "-e", "process.stdout.write(process.version + ' ' + typeof Bun)"]);
  if (probe === undefined) throw new BuildError(`no node on PATH; ${hint}`);
  const [version = "", runtime] = probe.split(" ");
  if (runtime !== "undefined") throw new BuildError(`\`node\` on PATH is Bun's shim (${version}), not Node; ${hint}`);
  const parts = /^v(\d+)\.(\d+)\.(\d+)/.exec(version)?.slice(1).map(Number);
  if (!parts || !atLeast(parts, MIN_NODE)) throw new BuildError(`node ${version} is too old; ${hint}`);
  console.log(`node ${version} (>= ${wanted})`);
}

function readVersion(): string {
  const pkg: unknown = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const version = typeof pkg === "object" && pkg !== null && "version" in pkg ? pkg.version : undefined;
  // Strict so the value can be inlined as a string literal without any escaping concerns.
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new BuildError(`package.json version ${JSON.stringify(version)} is not a plain semver string`);
  }
  return version;
}

function outfile(target: Target): string {
  return `${DIST}/spectant-${target.name}`;
}

async function compile(target: Target, version: string): Promise<void> {
  const out = outfile(target);
  await exec(
    [
      process.execPath,
      "build",
      "--compile",
      `--target=${target.bunTarget}`,
      "--minify",
      // No `--sourcemap` flag on purpose: none is the default, and with bun 1.3.12 an explicit `--sourcemap=none`
      // under `--compile` still writes a stray `dist/main.js.map` beside the binary.
      "--define",
      `SPECTANT_VERSION=${JSON.stringify(version)}`,
      ENTRY,
      "--outfile",
      out,
    ],
    `compile ${target.name}`,
  );
  if (!existsSync(join(ROOT, out))) throw new BuildError(`compile ${target.name} reported success but wrote no ${out}`);
}

async function sign(target: Target): Promise<void> {
  const out = outfile(target);
  // Bun may have signed already, and cross-compiled binaries can carry a signature that no longer matches; drop
  // whatever is there (failure means there was none) and sign ad hoc.
  capture(["codesign", "--remove-signature", out]);
  await exec(["codesign", "-s", "-", "-f", out], `codesign ${target.name}`);
}

function formatSize(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function main(argv: string[]): Promise<void> {
  const { targets, skipWeb } = parseArgs(argv);
  const version = readVersion();
  const built: Target[] = [];
  const started = performance.now();
  console.log(`spectant ${version}: building ${targets.map((target) => target.name).join(", ")}`);
  // A binary from an earlier build must never pass for this one when a later step fails.
  for (const target of targets) rmSync(join(ROOT, outfile(target)), { force: true });

  try {
    if (skipWeb) {
      console.log("\n▸ web build skipped (--skip-web); embedding the existing web/dist/browser");
    } else {
      await step("web build (Angular CLI on Node)", async () => {
        checkNode();
        await exec([process.execPath, "run", "--cwd", "web", "build"], "web build");
      });
    }

    await step("embed web output", () => exec([process.execPath, "scripts/embed.ts"], "embed"));

    mkdirSync(join(ROOT, DIST), { recursive: true });
    for (const target of targets) {
      await step(`compile ${target.name} (${target.bunTarget})`, () => compile(target, version));
      built.push(target);
    }

    const darwin = built.filter((target) => target.os === "darwin");
    if (darwin.length > 0) {
      if (process.platform === "darwin") {
        await step("ad-hoc codesign darwin binaries", async () => {
          for (const target of darwin) await sign(target);
        });
      } else {
        console.log(
          `\nnotice: ${darwin.map(outfile).join(", ")} ${darwin.length === 1 ? "is" : "are"} unsigned; ` +
            "sign on macOS (`codesign -s - -f <file>`) before release, or macOS kills the binary on launch",
        );
      }
    }
  } catch (error) {
    if (built.length > 0) {
      const missing = targets.filter((target) => !built.includes(target)).map(outfile);
      console.error(
        `\nbuild: ${DIST}/ is PARTIAL — built: ${built.map(outfile).join(", ")}; ` +
          `missing or unsigned: ${missing.join(", ") || "none (signing failed)"}. Do not release from it.`,
      );
    }
    throw error;
  }

  console.log("\n  binary                      size");
  for (const target of built) {
    const out = outfile(target);
    console.log(`  ${out.padEnd(26)}  ${formatSize(statSync(join(ROOT, out)).size).padStart(8)}`);
  }
  console.log(`\nbuild: ${built.length} binaries in ${((performance.now() - started) / 1000).toFixed(1)} s`);
}

if (import.meta.main) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    if (!(error instanceof BuildError)) throw error;
    console.error(`build: ${error.message}`);
    process.exit(1);
  }
}
