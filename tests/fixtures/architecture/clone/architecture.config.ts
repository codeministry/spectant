/**
 * Fixture configuration for the duplicates rule (spec 059, ISC-414): one lane whose root holds a block of more than
 * 50 tokens copied from `src/original.ts` into `src/nested/copy.ts`, which is flagged.
 */
import type { ArchitectureConfig } from "../../../../scripts/architecture.config.ts";

const config: ArchitectureConfig = {
  lanes: [
    {
      name: "fixture-clone",
      root: "tests/fixtures/architecture/clone/src",
      extensions: [".ts"],
      ignore: [],
      duplicates: { minTokens: 50 },
    },
  ],
};

export default config;
