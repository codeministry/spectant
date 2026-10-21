/**
 * The entry of the compiled `spectant` binary (T11, ISC-8) and the only module that imports the generated manifest,
 * `server/embedded.gen.ts` (`scripts/embed.ts`, contract in `contracts/assets.contract.ts`).
 *
 * The import is dynamic with a literal specifier: `bun build --compile` still bundles it, together with every web
 * file it names, while `bun server/src/main.ts` on a checkout without a web build gets a readable hint instead of a
 * bare module-resolution error.
 */
import type { EmbeddedManifest } from "./contracts/assets.contract.ts";
import { run } from "./cli/index.ts";
import { manifestFailure, manifestHint, type ManifestFailure } from "./infra/manifest-load.ts";

async function loadManifest(): Promise<EmbeddedManifest | ManifestFailure> {
  try {
    return (await import("../embedded.gen.ts")).default;
  } catch (error) {
    // A missing manifest and a stale one (it imports a web file a later build replaced) each get their own hint; any
    // other failure inside it is a real bug and propagates (`infra/manifest-load.ts`).
    const failure = manifestFailure(error);
    if (failure === undefined) throw error;
    return failure;
  }
}

const manifest = await loadManifest();
if (typeof manifest === "string") {
  console.error(manifestHint(manifest));
  process.exit(1);
}
process.exit(await run(process.argv.slice(2), manifest));
