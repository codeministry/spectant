/**
 * Fixture configuration for the size rule (spec 059, ISC-413): one lane whose root holds a file of 401 lines, which
 * is flagged, and one of 400 lines, which is not.
 */
import type { ArchitectureConfig } from "../../../../scripts/architecture.config.ts";

const config: ArchitectureConfig = {
  lanes: [
    {
      name: "fixture-oversize",
      root: "tests/fixtures/architecture/oversize/src",
      extensions: [".ts"],
      ignore: [],
      size: { maxLines: 400 },
    },
  ],
};

export default config;
