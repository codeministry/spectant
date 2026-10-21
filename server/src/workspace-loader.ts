// Moved to `workspace/` (spec 059, T36 and T37) and the catalog loads to `library/` (T42); this shim keeps the old
// import path until T61 removes it.
export * from "./workspace/index.ts";
export { type CopiesLoad, loadCatalog, loadCatalogDoc, loadCatalogDocs, readRepoCatalogFiles } from "./library/index.ts";
