import type { LibraryCatalog, LibraryDoc } from '../../../../../core/src/files';
import {
  type LibraryDocPage,
  type LibrarySearchResult,
  prototypeFolderOf,
  prototypeRoute,
  workspaceRoutes,
} from '../../../../../server/src/contracts/spec-routes.contract';
import type { ApiResult, HttpCore } from './http-core';

/** The workspace's library (spec 017): the catalog, its documents and the search; the URLs below read no state. */
export class LibraryClient {
  constructor(private readonly core: HttpCore) {}

  /**
   * The workspace's library catalog (spec 017, T25, ISC-156): core's `LibraryCatalog`, metadata only, served as it is
   * and ETag-cached like `planning()`. A workspace without `specs/` answers an empty catalog, not a 404.
   */
  library(ws: string): Promise<ApiResult<LibraryCatalog>> {
    return this.core.get(workspaceRoutes.library(ws));
  }

  /**
   * One Markdown document of the catalog, rendered as a Docs page (`DocsPage`), by its `LibraryDoc.path`. A path the
   * catalog does not list as a present Markdown document is the contract's 404: `not-found`, served.
   */
  libraryDoc(ws: string, path: string): Promise<ApiResult<LibraryDocPage>> {
    return this.core.get(workspaceRoutes.libraryDoc(ws, path));
  }

  /**
   * The server's search over titles and full text (`LibrarySearchResult`: the query as read, hits in catalog order).
   * An empty or whitespace-only query answers `{query: '', hits: []}` without a request, as the server would.
   */
  librarySearch(ws: string, q: string): Promise<ApiResult<LibrarySearchResult>> {
    if (q.trim() === '') return Promise.resolve({ kind: 'ok', body: { query: '', hits: [] }, etag: null, notModified: false });
    return this.core.get(workspaceRoutes.librarySearch(ws, q));
  }
}

/**
 * The URL of one image below `specs/` (`…/library/asset?path=`), the successor of `techAssetUrl`. A URL, not a
 * read: the browser loads it as an `<img>` source.
 */
export function libraryAssetUrl(ws: string, path: string): string {
  return workspaceRoutes.libraryAsset(ws, path);
}

/**
 * The URL of one page of a `prototype` catalog document (`/proto/:ws/:spec/:folder/<page>`, outside `/api/`, opened
 * in a new tab), `page` one of `doc.pages`. Null for a document that is no prototype folder. A path, no origin.
 */
export function prototypeUrl(ws: string, doc: Pick<LibraryDoc, 'path' | 'spec' | 'type' | 'archived'>, page: string): string | null {
  const folder = doc.type === 'prototype' ? prototypeFolderOf(doc) : null;
  return folder === null ? null : prototypeRoute(ws, doc.spec, folder, page);
}
