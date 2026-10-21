/**
 * architecture.config — the lane entries `scripts/check-architecture.ts` checks (spec 059, ISC-415).
 *
 * One entry per lane. Each entry names a root and the files under it; every optional section switches one rule on
 * for that entry, and a rule never runs on an entry that leaves its section out. A new lane adds an entry here and
 * changes no rule: the web entry (spec 060, ISC-423) lives in `architecture/web.entry.ts` and is listed below.
 *
 * Paths: `root` is relative to the repository root; `ignore` patterns and the layout and io folder names are relative
 * to `root`. Patterns are `Bun.Glob` globs.
 */
import { TEST_AND_GENERATED } from "./architecture/files.ts";
import { web } from "./architecture/web.entry.ts";

/** Line limit per file (ISC-413). */
export type SizeConfig = {
  /** A file with more lines than this is a violation. */
  maxLines: number;
};

/** A named clone the duplicates rule accepts (spec 060): two files, relative to `root`, and why they stay apart. */
export type DuplicateAllowance = {
  /** The two files of the clone, relative to `root`; the order does not matter. */
  files: [string, string];
  /** Why the copied block has no shared rule; a clone without a reason is never accepted. */
  why: string;
};

/** Copied blocks across the files of the root (ISC-414). */
export type DuplicatesConfig = {
  /** A copied block of at least this many tokens is a violation. */
  minTokens: number;
  /** Named exceptions: a clone between exactly these two files is not a violation. */
  allow?: DuplicateAllowance[];
};

/** The folder shape of the root (ISC-409). */
export type LayoutConfig = {
  /** The only files allowed directly in the root. */
  topLevelFiles: string[];
  /** Shared area folders that are not slices; every other folder of the root is a slice. */
  areas: string[];
  /** The file every slice needs: its one public surface. */
  sliceEntry: string;
};

/** The import graph between slices and areas (ISC-410); slices and areas are the ones `layout` names. */
export type ImportsConfig = {
  /** A slice imports another slice only through that slice's entry file. */
  sliceEntryOnly: boolean;
  /** No area imports a slice. */
  areasImportNoSlice: boolean;
  /** No import cycle between slices. */
  noSliceCycles: boolean;
};

/** Direct I/O only inside the named folders (ISC-411). */
export type IoConfig = {
  /** Folders of the root where the modules and calls below are allowed. */
  allowedIn: string[];
  /** Module specifiers no file outside `allowedIn` imports. */
  modules: string[];
  /** Member calls no file outside `allowedIn` makes. */
  calls: string[];
};

/** The layer order of the root (spec 060, ISC-424). */
export type LayersConfig = {
  /** Top folders of the root, lowest layer first: a file of one layer imports no file of a layer after it. */
  order: string[];
};

export type LaneEntry = {
  /** The lane's name, as it appears in the output. */
  name: string;
  /** The checked folder, relative to the repository root. */
  root: string;
  /** File extensions every rule looks at. */
  extensions: string[];
  /** Files no rule looks at (tests, generated files), as globs relative to `root`. */
  ignore: string[];
  size?: SizeConfig;
  duplicates?: DuplicatesConfig;
  layout?: LayoutConfig;
  imports?: ImportsConfig;
  io?: IoConfig;
  layers?: LayersConfig;
};

export type ArchitectureConfig = {
  lanes: LaneEntry[];
};

// Test and generated files, which no rule of any lane looks at. The list lives in `architecture/files.ts`, so a lane
// entry kept in a file of its own (`architecture/web.entry.ts`) uses it without an import cycle through this file.
export { TEST_AND_GENERATED };

const config: ArchitectureConfig = {
  lanes: [
    {
      name: "server",
      root: "server/src",
      extensions: [".ts"],
      ignore: TEST_AND_GENERATED,
      size: { maxLines: 400 },
      duplicates: { minTokens: 50 },
      layout: { topLevelFiles: ["main.ts"], areas: ["infra", "contracts"], sliceEntry: "index.ts" },
      imports: { sliceEntryOnly: true, areasImportNoSlice: true, noSliceCycles: true },
      io: {
        allowedIn: ["infra"],
        modules: ["node:fs", "node:fs/promises", "node:child_process", "bun:sqlite"],
        calls: ["Bun.spawn", "Bun.file", "Bun.write"],
      },
    },
    web,
  ],
};

export default config;
