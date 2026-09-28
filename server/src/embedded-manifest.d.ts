// The type of the generated `server/embedded.gen.ts` for a checkout that has none yet (it is gitignored and written
// by `scripts/embed.ts`), so `tsc` and ESLint pass on a fresh checkout. TypeScript consults this pattern only when
// the relative import does not resolve; once the file exists, its own types win. Only `main.ts` imports it.
declare module "*/embedded.gen.ts" {
  const manifest: import("./assets.contract.ts").EmbeddedManifest;
  export { manifest };
  export default manifest;
}
