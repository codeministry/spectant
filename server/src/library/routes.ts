/**
 * The library routes (spec 017), each matched by the contract's `matchWorkspacePath` and dispatched by `dashboardApi`
 * after its guard and method check, with the planning route's statuses: 404 unknown workspace, 409 with the summary
 * when the folder cannot be read.
 *
 * - The catalog (T15, ISC-156): `GET`/`HEAD /api/workspaces/:ws/library` → `LibraryCatalog`, core's `readCatalog`
 *   through `loadCatalog` (`load.ts`) as it is: metadata only (path, type, spec, title, modified, state), never a
 *   document's content and never an absolute path, since every catalog path is relative to `specs/`. Nothing is
 *   cached; the ETag is `json()`'s body hash and each entry carries its mtime, so any change to a document is a new
 *   tag. The catalog is read over the dashboard's own input (`readWorkspaceInput`, LifeOS locks under the context's
 *   state directory), so a group head's stage equals the dashboard row's, a fresh code-reviewed mark included.
 *
 * The reader and the search (T17, T18, ISC-156.2, ISC-156.3) never read the dashboard model (ISC-156.5): the reader
 * reads the one asked document (`loadCatalogDoc`, core's `catalogDocAt`), the search the catalog's documents
 * (`loadCatalogDocs`, core's `readCatalogDocs`), each with the worktree copies alone; the file behind a document is
 * `catalog-file.ts`'s.
 * - `libraryDoc`, `GET …/library/doc?path=` (the raw query value, decoded once): the document rendered as its Docs tab
 *   renders it, `renderDocsMarkdown` with `docsRenderOptions` (the constitution's and the Design tab's own options by
 *   type, else a plain page), so relative images confined to the workspace and `.design/` assets resolve as on a Docs
 *   tab. 404 for any path the catalog does not list as such a document, never a read of the path. `tech.md` adds
 *   `techSections`, core's `techSectionHeads` over the same text, and its page is core's `renderTechDocument`, each
 *   marker's part a `<section data-tech-part="key">`, so the reader cuts its sections by core's markers, never at an
 *   h2 (ISC-157.2, ISC-355).
 * - `librarySearch`, `GET …/library/search?q=`: `search.ts`. A blank `q` is `{query: '', hits: []}`, never 400.
 * - `libraryAsset`, `GET …/library/asset?path=`: one image below `specs/`, the evidence file route
 *   (`infra/http/file-response.ts`) with the workspace's `specs/` as the root: the same once-decoded resolver, every
 *   file below the real `specs/` reachable, images only. A path into the folder of a spec read from its worktree copy
 *   resolves below the copy's `specs/` instead (spec 039, ISC-208). 200 with the bytes and the evidence headers (ETag,
 *   304), 403 for `..`, a second encoding, an absolute path, a symlink out or another media type, 404 for a missing
 *   file or workspace.
 * The tech page's routes (`…/tech`, `…/tech/asset`) went with spec 017 T51: the library replaces them (ISC-157.1),
 * and a request to either is the unmatched API path's 404.
 */
import { dirname, join } from "node:path";
import { SPEC_FOLDER } from "../../../core/src/spec-ref.ts";
import { techSectionHeads } from "../../../core/src/tech.ts";
import { type WorkspaceRouteResponses, evidencePathQuery } from "../contracts/spec-routes.contract.ts";
import { readText } from "../infra/fs/list.ts";
import { evidenceFileResponse } from "../infra/http/file-response.ts";
import { json } from "../infra/http/json.ts";
import { type WorkspaceContext, readCopies, readRepoFile, summaryOf, unavailable, unreadableCode } from "../workspace/index.ts";
import { catalogFile, isFile, isFolder, renderCatalogDoc } from "./catalog-file.ts";
import { catalogLoaders } from "./load.ts";
import { librarySearcher } from "./search.ts";

/** The `path` query value of a reader or asset request, decoded once; null when it does not decode. */
function decodedPathQuery(search: string): string | null {
  try {
    return decodeURIComponent(evidencePathQuery(search));
  } catch {
    return null;
  }
}

/** The four library routes over one context; the caller has guarded, matched and method-checked the request. */
export function libraryRoutes(ctx: WorkspaceContext): {
  library: (req: Request, slug: string) => Promise<Response>;
  libraryDoc: (req: Request, slug: string, search: string) => Promise<Response>;
  librarySearch: (req: Request, slug: string, q: string) => Promise<Response>;
  libraryAsset: (req: Request, slug: string, search: string) => Promise<Response>;
} {
  const { registry, stateDir } = ctx;
  const { catalogOf, docsOf, docOf } = catalogLoaders(ctx);
  const search = librarySearcher();

  // The catalog as core's readCatalog builds it, metadata only, never reshaped (header).
  const library = async (req: Request, slug: string): Promise<Response> => {
    const workspace = registry.get(slug);
    if (!workspace) return json(req, 404, { error: "not-found" });
    const loaded = await catalogOf(workspace.path, stateDir);
    if (!loaded.readable) return json(req, 409, summaryOf(workspace, loaded));
    const body: WorkspaceRouteResponses["library"] = loaded.catalog;
    return json(req, 200, body);
  };

  // One Markdown document of the catalog as a Docs page; 404 for anything the catalog does not list as one (header).
  const libraryDoc = async (req: Request, slug: string, query: string): Promise<Response> => {
    const workspace = registry.get(slug);
    if (!workspace) return json(req, 404, { error: "not-found" });
    // A path that does not decode names no document, but an unreadable workspace still answers 409 first.
    const loaded = await docOf(workspace.path, decodedPathQuery(query));
    if (!loaded.readable) return json(req, 409, summaryOf(workspace, loaded));
    const file = loaded.doc === null ? null : await catalogFile(workspace.path, loaded.doc, loaded.copies, loaded.repoFiles);
    if (file === "symlink-escape") return json(req, 403, { error: "forbidden" }); // a worktree copy linked out (ISC-216.1)
    if (file === null) return json(req, 404, { error: "not-found" });
    let source: string;
    try {
      source = readText(file.absolute);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | null)?.code;
      if (typeof code !== "string") throw error;
      if (code === "ENOENT") return json(req, 404, { error: "not-found" }); // gone since the catalog was read
      return json(req, 409, unavailable(workspace, unreadableCode(error)));
    }
    const page = renderCatalogDoc(workspace.path, file, source);
    // tech.md carries core's section heads, since the rendered page drops its markers (ISC-157.2); no other document does.
    const body: WorkspaceRouteResponses["libraryDoc"] = file.doc.type === "tech" ? { ...page, techSections: techSectionHeads(source) } : page;
    return json(req, 200, body);
  };

  // Title and full text of the catalog's Markdown documents, case-insensitive, hits in catalog order (`search.ts`).
  const librarySearch = async (req: Request, slug: string, q: string): Promise<Response> => {
    const workspace = registry.get(slug);
    if (!workspace) return json(req, 404, { error: "not-found" });
    const loaded = await docsOf(workspace.path);
    if (!loaded.readable) return json(req, 409, summaryOf(workspace, loaded));
    const query = q.trim();
    if (query === "") {
      const empty: WorkspaceRouteResponses["librarySearch"] = { query: "", hits: [] };
      return json(req, 200, empty);
    }
    const body: WorkspaceRouteResponses["librarySearch"] = { query, hits: await search(workspace.path, query, loaded) };
    return json(req, 200, body);
  };

  // One image below specs/, through the evidence file route's resolver and answer (header). A path into the folder of a
  // spec read from its worktree copy is served from the copy's `specs/` (spec 039, ISC-208), as the reader read the
  // document that names it; a copy folder gone by now falls back to the main checkout, as `catalogFile` does.
  const libraryAsset = async (req: Request, slug: string, query: string): Promise<Response> => {
    const workspace = registry.get(slug);
    if (!workspace) return json(req, 404, { error: "not-found" });
    // A path that does not decode is refused by the resolver below, from the main checkout.
    const path = decodedPathQuery(query);
    const first = path?.split("/")[0] ?? null;
    const copy = first === null ? undefined : (await readCopies(workspace.path))[first];
    let specsDir = copy !== undefined && (await isFolder(copy)) ? dirname(copy) : join(workspace.path, "specs");
    // An image outside every spec folder belongs to the workspace documents and follows `tech.md`'s read source (spec
    // 039, ISC-209) while the worktree holds it; otherwise it is the main checkout's.
    if (copy === undefined && path !== null && first !== null && !SPEC_FOLDER.test(first)) {
      const tech = await readRepoFile(workspace.path, "specs/tech.md");
      const below = tech.source.kind === "worktree" ? join(workspace.path, tech.source.worktree, "specs") : null;
      if (below !== null && (await isFile(join(below, ...path.split("/"))))) specsDir = below;
    }
    return evidenceFileResponse(req, specsDir, query, {
      reach: "tree",
      serves: (mediaType) => mediaType.startsWith("image/"),
    });
  };

  return { library, libraryDoc, librarySearch, libraryAsset };
}
