/**
 * Fixture configuration for the architecture guard (spec 059, ISC-415): one lane with the size and duplicates rules
 * over a root neither flags, so the guard exits 0.
 */
import type { ArchitectureConfig } from "../../../../scripts/architecture.config.ts";

const config: ArchitectureConfig = {
  lanes: [
    {
      name: "fixture-clean",
      root: "tests/fixtures/architecture/clean/src",
      extensions: [".ts"],
      ignore: [],
      size: { maxLines: 400 },
      duplicates: { minTokens: 50 },
    },
  ],
};

export default config;
