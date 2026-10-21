/**
 * Fixture configuration for a named duplicates exception (spec 060, ISC-423): the clone fixture's root with an
 * `allow` entry for exactly its copied pair, listed in the order opposite to jscpd's report, so the clone is accepted
 * and the lane is green. `architecture.config.ts` beside it is the same lane without the entry, which stays red.
 */
import type { ArchitectureConfig } from "../../../../scripts/architecture.config.ts";

const config: ArchitectureConfig = {
  lanes: [
    {
      name: "fixture-clone-allowed",
      root: "tests/fixtures/architecture/clone/src",
      extensions: [".ts"],
      ignore: [],
      duplicates: {
        minTokens: 50,
        allow: [{ files: ["original.ts", "nested/copy.ts"], why: "fixture: the copied block is the named exception" }],
      },
    },
  ],
};

export default config;
