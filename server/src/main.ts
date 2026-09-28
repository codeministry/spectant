/**
 * The entry of the compiled `spectant` binary (T11, ISC-8) and the only module that imports the generated manifest,
 * `server/embedded.gen.ts` (`scripts/embed.ts`, contract in `assets.contract.ts`).
 *
 * The import is dynamic with a literal specifier: `bun build --compile` still bundles it, together with every web
 * file it names, while `bun server/src/main.ts` on a checkout without a web build gets a readable hint instead of a
 * bare module-resolution error.
 */
import type { EmbeddedManifest } from "./assets.contract.ts";
import { run } from "./cli.ts";

async function loadManifest(): Promise<EmbeddedManifest | undefined> {
  try {
    return (await import("../embedded.gen.ts")).default;
  } catch (error) {
    // Only a missing manifest gets the hint; any other failure inside it is a real bug and propagates. Bun reports a
    // failed resolution as a `ResolveMessage`, which is not an `Error` subclass, hence `String()`.
    if (!/Cannot find module .*embedded\.gen\.ts/.test(String(error))) throw error;
    return undefined;
  }
}

const manifest = await loadManifest();
if (manifest === undefined) {
  console.error(
    "spectant: server/embedded.gen.ts is missing; build the web app and embed it first:\n" +
      "  bun run --cwd web build && bun scripts/embed.ts\n" +
      "or build the binaries with `bun run build`.",
  );
  process.exit(1);
}
process.exit(await run(process.argv.slice(2), manifest));
