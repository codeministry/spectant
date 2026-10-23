/**
 * The status route contract (spec 071, ISC-593; plan 071 § Interfaces): `GET /api/status` answers the open and the
 * recently closed specs of every registered workspace in one body, for the status widget.
 *
 * Consumers, building against this file without talking to each other:
 * 1. `server/src/status/` reads every registered workspace at the request's clock and answers `StatusResponse`, which
 *    core's `statusBoard` builds; `ETag` over the body, 304 on `If-None-Match`.
 * 2. `web/e2e/stub-api.ts` answers the same path from the fixture trees through the same `statusBoard`.
 * 3. The web status widget reads it and replaces its answer when a live frame carries the view `STATUS_PATH`.
 *
 * Like `ACTORS_PATH` it names no workspace and is no workspace family's. 403 is a foreign `Host` or `Origin`, 405 any
 * method but `GET` and `HEAD` with `STATUS_ALLOW`. No field names an absolute path: a workspace carries its slug and
 * path tail only. Browser-safe: the imports are `assets.contract.ts` and core types.
 */
import { API_PREFIX } from './assets.contract.ts';
import type { StatusResponse } from '../../../core/src/status-board.ts';

export type { StatusKpis, StatusResponse, StatusSpec, StatusWorkspace } from '../../../core/src/status-board.ts';

export const STATUS_PATH = `${API_PREFIX}status`;
export const STATUS_ALLOW = 'GET, HEAD';
export const STATUS_STATUSES = [200, 304, 403, 405] as const;

/** The 200 body of `GET /api/status`, named for the route table's readers. */
export type StatusBody = StatusResponse;
