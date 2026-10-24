// The texts of one spec folder as the app's loader reads them, shared by `spec-check` and `repo-docs.ts` so `status`
// and `tldr facts` hand `core/` the same files. Reads only; what the texts mean is `core/`'s.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FILE_KINDS } from '../../core/src/files.ts';
import type { SpecFiles, TextFileKind } from '../../core/src/files.ts';
import type { SpecRef } from '../../core/src/resolve.ts';

/** A file's text, or null when it does not exist; any other read error is thrown. */
export function readIfExists(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/** The text file kinds inside a spec folder, as the app's loader reads them. */
export const FOLDER_KINDS = (Object.keys(FILE_KINDS) as Array<keyof typeof FILE_KINDS>).filter(
  (kind): kind is TextFileKind => !FILE_KINDS[kind].directory && !FILE_KINDS[kind].path.startsWith('..'),
);

/** Every text of `FOLDER_KINDS` the folder holds, under the folder's name. */
export function specFiles(ref: Pick<SpecRef, 'dir' | 'slug'>): SpecFiles {
  const texts: Partial<Record<TextFileKind, string>> = {};
  for (const kind of FOLDER_KINDS) {
    const text = readIfExists(join(ref.dir, FILE_KINDS[kind].path));
    if (text !== null) texts[kind] = text;
  }
  return { folder: ref.slug, texts };
}
