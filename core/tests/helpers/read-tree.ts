// Test helper: a fixture tree under `core/fixtures/` read from disk into `buildDashboard`'s input, as the server
// reads a registered workspace. The files are read here, in the tests; `buildDashboard` stays pure over the text.
// A test helper only: the server has its own loader, and `core/src/` reads no file.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { DashboardInput } from '../../src/dashboard.ts';
import { FILE_KINDS } from '../../src/files.ts';
import type { SpecFiles, TextFileKind } from '../../src/files.ts';

export const FIXTURES = join(import.meta.dir, '..', '..', 'fixtures');

/** The per-folder file kinds (everything inside `specs/NNN-slug/`); master and constitution come in once per tree. */
const FOLDER_KINDS = (Object.keys(FILE_KINDS) as Array<keyof typeof FILE_KINDS>).filter(
  (kind): kind is TextFileKind => !FILE_KINDS[kind].directory && !FILE_KINDS[kind].path.startsWith('..'),
);

function readIfExists(path: string): string | null {
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

/** Every spec folder directly under `dir` (`NNN-slug`), in name order, with the texts of the files it holds. */
export function folders(dir: string): SpecFiles[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^\d{3}-/.test(e.name))
    .map((e) => e.name)
    .sort()
    .map((folder) => {
      const texts: Partial<Record<TextFileKind, string>> = {};
      for (const kind of FOLDER_KINDS) {
        const text = readIfExists(join(dir, folder, FILE_KINDS[kind].path));
        if (text !== null) texts[kind] = text;
      }
      return { folder, texts };
    });
}

/** The name of every fixture tree: each directory directly under `core/fixtures/`, in name order. */
export function fixtureTrees(): string[] {
  return readdirSync(FIXTURES, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

/** Any repository root read into the model's input, as the server reads a registered workspace. */
export function readTreeAt(root: string, worktreeTree: string | null = null): DashboardInput {
  return {
    master: readIfExists(join(root, 'ISA.md')),
    constitution: readIfExists(join(root, 'specs', 'constitution.md')),
    tldr: readIfExists(join(root, 'specs', 'tldr.md')),
    specs: folders(join(root, 'specs')),
    archived: folders(join(root, 'specs', 'archive')),
    worktreeTree,
  };
}

/** A fixture tree by name. */
export function readTree(name: string): DashboardInput {
  return readTreeAt(join(FIXTURES, name));
}
