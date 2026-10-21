/**
 * A workspace's active spec count, `counts.specs` read narrowly: `WorkspaceListEntry.counts` is untyped in web
 * (api.service.ts). Shared by the workspace picker (`shell-menus.ts`) and the palette's Workspaces group.
 */
export const specCountOf = (counts: unknown): number | null => {
  if (typeof counts !== 'object' || counts === null) return null;
  const specs = (counts as Readonly<Record<string, unknown>>)['specs'];
  return typeof specs === 'number' ? specs : null;
};
