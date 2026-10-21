/**
 * Fixture configuration for the architecture guard (spec 059, ISC-415): two lanes, each with its own root and its own
 * sections, so a new lane is checked from its configuration entry alone. The oversize lane is flagged by `size`, the
 * clone lane by `duplicates`.
 */
import type { ArchitectureConfig } from "../../../scripts/architecture.config.ts";

const config: ArchitectureConfig = {
  lanes: [
    {
      name: "fixture-oversize",
      root: "tests/fixtures/architecture/oversize/src",
      extensions: [".ts"],
      ignore: [],
      size: { maxLines: 400 },
    },
    {
      name: "fixture-clone",
      root: "tests/fixtures/architecture/clone/src",
      extensions: [".ts"],
      ignore: [],
      size: { maxLines: 400 },
      duplicates: { minTokens: 50 },
    },
  ],
};

export default config;
