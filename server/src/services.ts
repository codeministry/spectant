// Moved to `workspace/` (spec 059, T39); this shim keeps the old import path until T61 removes it.
export {
  type DevService,
  type DevServiceKind,
  type HttpProbe,
  type ListServicesOptions,
  type LoopbackHost,
  type LsofRun,
  PROBE_TIMEOUT_MS,
  listServices,
  probeHttp,
} from "./workspace/index.ts";
