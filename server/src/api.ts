// Moved to the router (spec 059, T55): the workspace family and its list and dashboard handlers to `workspace/`, the
// composition `dashboardApi` to `cli/`; this shim keeps the old import path until T61 removes it.
export { dashboardApi } from "./cli/index.ts";
export { composeApi, json } from "./infra/http/json.ts";
export { actorsApi } from "./settings/index.ts";
export {
  type DashboardApiOptions,
  type ImagesOf,
  type WorkspaceListSummary,
  type WorkspaceSummary,
  NO_IMAGES,
  WORKSPACES_PATH,
  localDate,
  workspaceSummaryReader,
} from "./workspace/index.ts";
