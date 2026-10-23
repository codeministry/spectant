/**
 * The `status/` slice's one public surface (spec 071, ISC-593): `GET /api/status`, the status board over every
 * registered workspace, as the router's family, its handlers and the route alone as an `ApiHandler`.
 */
export { STATUS_FAMILY, type StatusContext, statusApi, statusHandlers } from "./routes.ts";
