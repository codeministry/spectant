/**
 * The Spectant version (T11, ISC-8; plan 001 § Approach "Embedding").
 *
 * A compiled binary has no `package.json` beside it, so `scripts/build.ts` inlines the root version with
 * `bun build --define SPECTANT_VERSION='"0.1.0"'`. The bundler then folds the `typeof` check to `true` and drops the
 * fallback. Under `bun run` nothing is defined, and the fallback reads the root `package.json` from the checkout.
 */
import { readFileSync } from "node:fs";

declare const SPECTANT_VERSION: string | undefined;

function versionFromPackageJson(): string {
  const pkg: unknown = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
  if (typeof pkg === "object" && pkg !== null && "version" in pkg && typeof pkg.version === "string") {
    return pkg.version;
  }
  throw new Error("the root package.json has no version string");
}

export const VERSION: string = typeof SPECTANT_VERSION === "string" ? SPECTANT_VERSION : versionFromPackageJson();
