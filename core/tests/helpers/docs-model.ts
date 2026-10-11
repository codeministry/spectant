// Test helper: the `docs` golden family (`<tree>.docs.golden.json`, T25, ISC-84). Every Docs tab page of a fixture
// tree as `renderDocsMarkdown` builds it: the tree's constitution once, then per spec folder in `listSpecs` order
// (active and archived, keyed by `specs/…` path) its plan, design and decisions pages; null where the file is absent.
// Image options are the server's (`docsRenderOptions`): existence from the file system, confined; nothing is read.
import { existsSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { docsRenderOptions } from '../../src/evidence.ts';
import { DOC_FILES, specFilePath } from '../../src/files.ts';
import type { DocName, DocsPage } from '../../src/files.ts';
import { renderDocsMarkdown } from '../../src/markdown-docs.ts';
import { listSpecs } from '../../src/resolve.ts';

const FOLDER_DOCS = (Object.keys(DOC_FILES) as DocName[]).filter((name) => name !== 'constitution');

function page(root: string, path: string, name: DocName): DocsPage | null {
  if (!existsSync(path)) return null;
  // The server's own options (`docsRenderOptions`), so the golden is what the route renders.
  return renderDocsMarkdown(readFileSync(path, 'utf8'), docsRenderOptions(root, path, name));
}

export function docsModel(root: string): unknown {
  const specs: Record<string, Partial<Record<DocName, DocsPage | null>>> = {};
  for (const ref of listSpecs(root)) {
    const folder = relative(root, ref.dir).split(sep).join('/');
    specs[folder] = Object.fromEntries(FOLDER_DOCS.map((name) => [name, page(root, specFilePath(ref.dir, DOC_FILES[name]), name)]));
  }
  return { constitution: page(root, join(root, 'specs', 'constitution.md'), 'constitution'), specs };
}
