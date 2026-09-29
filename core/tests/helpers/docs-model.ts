// Test helper: the `docs` golden family (`<tree>.docs.golden.json`, T25, ISC-84). Every Docs tab page of a fixture
// tree as `renderDocsMarkdown` builds it: the tree's constitution once, then per spec folder in `listSpecs` order
// (active and archived, keyed by `specs/…` path) its plan, design and decisions pages; null where the file is absent.
// Image existence is answered from the file system, confined to the tree; no image file is ever read.
import { existsSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

import { DOC_FILES, specFilePath } from '../../src/files.ts';
import type { DocName, DocsPage } from '../../src/files.ts';
import { renderDocsMarkdown } from '../../src/markdown-docs.ts';
import { listSpecs } from '../../src/resolve.ts';

const FOLDER_DOCS = (Object.keys(DOC_FILES) as DocName[]).filter((name) => name !== 'constitution');

function page(root: string, path: string): DocsPage | null {
  if (!existsSync(path)) return null;
  const dir = resolve(path, '..');
  return renderDocsMarkdown(readFileSync(path, 'utf8'), {
    assetExists: (src) => {
      const target = resolve(dir, src);
      return !relative(root, target).startsWith('..') && existsSync(target);
    },
  });
}

export function docsModel(root: string): unknown {
  const specs: Record<string, Partial<Record<DocName, DocsPage | null>>> = {};
  for (const ref of listSpecs(root)) {
    const folder = relative(root, ref.dir).split(sep).join('/');
    specs[folder] = Object.fromEntries(FOLDER_DOCS.map((name) => [name, page(root, specFilePath(ref.dir, DOC_FILES[name]))]));
  }
  return { constitution: page(root, join(root, 'specs', 'constitution.md')), specs };
}
