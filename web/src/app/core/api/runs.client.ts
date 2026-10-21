import { HttpHeaders } from '@angular/common/http';
import { ACTIVITY_HASH_HEADER, workspaceRoutes } from '../../../../../server/src/contracts/spec-routes.contract';
import type { HttpCore, WriteResult } from './http-core';

/** The run writes of spec 040: the release of a running run. */
export class RunsClient {
  constructor(private readonly core: HttpCore) {}

  /**
   * Spec 040 (T61, ISC-226): `POST …/:ws/runs/:run/release` with the activity hash the page rendered in
   * `X-Spectant-Activity-Hash` and no body. 200 `RunReleased` (the log's new hash and the `run-end` line), 409
   * `StaleActivity`, 422 `RunReleaseRefused` (`no-viewer`, `run-aborted`), validated like `transition()`; a 404
   * (the run is unknown or already ended) is an `error`.
   */
  releaseRun(ws: string, run: string, hash: string): Promise<WriteResult<'runRelease'>> {
    return this.core.write('runRelease', workspaceRoutes.runRelease(ws, run), null, new HttpHeaders({ [ACTIVITY_HASH_HEADER]: hash }));
  }
}
