import { STATUS_PATH, type StatusResponse } from '../../../../../server/src/contracts/status.contract';
import type { ApiResult, HttpCore } from './http-core';

/** The status widget's read (spec 071, T16, ISC-593): the open and recently closed specs of every workspace. */
export class StatusClient {
  constructor(private readonly core: HttpCore) {}

  /**
   * `GET /api/status`, one body over every registered workspace in picker order, ETag-cached (304 replays it). A live
   * frame's view under `STATUS_PATH` replaces the cached answer (`ApiClient.prime`, spec 071 T34, ISC-587), so the next
   * read sends the frame's ETag and a 304 renders the frame's body, as every other read of the app does.
   */
  status(): Promise<ApiResult<StatusResponse>> {
    return this.core.get(STATUS_PATH);
  }
}
