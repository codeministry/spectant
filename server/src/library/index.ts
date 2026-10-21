/**
 * The `library/` slice's one public surface (spec 059): the document catalog of one workspace, its loads, the reader,
 * the search and the asset route (spec 017).
 */
export { type CatalogLoaders, type CopiesLoad, catalogLoaders, loadCatalog, loadCatalogDoc, loadCatalogDocs, readRepoCatalogFiles } from "./load.ts";
export { libraryRoutes } from "./routes.ts";
