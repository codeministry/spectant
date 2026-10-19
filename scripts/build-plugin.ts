#!/usr/bin/env bun
/**
 * build-plugin — the Spec plugin's bundled CLI (spec 031, T25, ISC-43).
 *
 * Usage: bun run build:plugin             (bundle, write, then validate the manifests when `claude` is on PATH)
 *        bun scripts/build-plugin.ts --check   (bundle in memory and compare bytes with the committed file)
 *
 * A marketplace install copies only `plugin/spectant/`, so the CLI the skill calls,
 * `bun "${CLAUDE_PLUGIN_ROOT}/bin/spec-check"`, must carry everything it needs: `Bun.build` of
 * `plugin/src/spec-check.ts` with every `core/` module it imports inlined (one parser, shipped as a copy, never a
 * second implementation). The output is committed, so it is built for readable diffs and stable bytes:
 *
 *  - target bun, minify off, no sourcemap: the unminified bundle (about 225 KB) is readable as it stands and keeps a
 *    `// core/src/<module>.ts` header per inlined module; an inline map would roughly double the file for no reader;
 *  - `root` is this repository, so those headers are repository-relative and the bytes do not depend on the checkout;
 *  - the file starts with `#!/usr/bin/env bun` and is written with the executable bit.
 *
 * After a build, `claude plugin validate --strict` runs on the marketplace (`.`) and on the plugin
 * (`./plugin/spectant`), each fatal on a non-zero exit; without `claude` on PATH the step is skipped with a notice.
 *
 * `--check` writes nothing and calls no `claude`: exit 0 when the committed bundle equals a fresh build, exit 1 when
 * it differs or is missing (`tests/plugin-bundle.test.ts` runs it, so `verify:quick` catches a stale bundle). The
 * bundle's bytes depend on the Bun version as well; the repository pins it (`packageManager`).
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const ENTRY = "plugin/src/spec-check.ts";
const OUT = "plugin/spectant/bin/spec-check";
const SHEBANG = "#!/usr/bin/env bun\n";

/** Bundles the CLI and returns the exact bytes the committed file must hold. */
async function bundle(): Promise<string> {
  const result = await Bun.build({
    entrypoints: [join(ROOT, ENTRY)],
    root: ROOT,
    target: "bun",
    format: "esm",
    minify: false,
    sourcemap: "none",
  });
  if (!result.success) {
    for (const log of result.logs) console.error(log);
    throw new Error(`bundling ${ENTRY} failed`);
  }
  const [entry] = result.outputs;
  if (entry === undefined || result.outputs.length !== 1) throw new Error(`expected one output for ${ENTRY}, got ${result.outputs.length}`);
  const text = await entry.text();
  return text.startsWith(SHEBANG) ? text : `${SHEBANG}${text.replace(/^#!.*\n/, "")}`;
}

function validate(): void {
  if (Bun.which("claude") === null) {
    console.log("claude is not on PATH: plugin validation skipped");
    return;
  }
  for (const target of [".", "./plugin/spectant"]) {
    const r = Bun.spawnSync(["claude", "plugin", "validate", "--strict", target], { cwd: ROOT, stdout: "inherit", stderr: "inherit" });
    if (r.exitCode !== 0) {
      console.error(`claude plugin validate --strict ${target} failed (exit ${r.exitCode})`);
      process.exit(1);
    }
    console.log(`claude plugin validate --strict ${target}: ok`);
  }
}

async function main(args: readonly string[]): Promise<void> {
  const unknown = args.filter((a) => a !== "--check");
  if (unknown.length > 0) {
    console.error(`unknown argument: ${unknown.join(" ")}\nusage: bun scripts/build-plugin.ts [--check]`);
    process.exit(1);
  }
  const fresh = await bundle();
  const out = join(ROOT, OUT);

  if (args.includes("--check")) {
    if (!existsSync(out)) {
      console.error(`${OUT} is missing: run \`bun run build:plugin\``);
      process.exit(1);
    }
    if (!Buffer.from(fresh).equals(readFileSync(out))) {
      console.error(`${OUT} differs from a fresh build of ${ENTRY}: run \`bun run build:plugin\` and commit the result`);
      process.exit(1);
    }
    console.log(`${OUT} is current`);
    return;
  }

  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, fresh);
  chmodSync(out, 0o755);
  console.log(`${OUT}: ${(Buffer.byteLength(fresh) / 1024).toFixed(1)} KB`);
  validate();
}

await main(process.argv.slice(2));
