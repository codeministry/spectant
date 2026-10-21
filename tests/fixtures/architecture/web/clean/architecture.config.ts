/**
 * Fixture configuration for the web entry (spec 060, ISC-423): the web entry of `scripts/architecture/web.entry.ts`
 * over a fixture root, whose component, template and stylesheet keep every
 * rule.
 */
import type { ArchitectureConfig } from "../../../../../scripts/architecture.config.ts";
import { web } from "../../../../../scripts/architecture/web.entry.ts";

const config: ArchitectureConfig = {
  lanes: [{ ...web, name: "fixture-web-clean", root: "tests/fixtures/architecture/web/clean/src" }],
};

export default config;
