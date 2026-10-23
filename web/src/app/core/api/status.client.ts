import { STATUS_PATH, type StatusResponse } from '../../../../../server/src/contracts/status.contract';
import type { ApiResult, HttpCore } from './http-core';

/** The status widget's read (spec 071, T16, ISC-593): the open and recently closed specs of every workspace. */
export class StatusClient {
  constructor(private readonly core: HttpCore) {}

  /** `GET /api/status`, one body over every registered workspace in picker order, ETag-cached (304 replays it). */
  status(): Promise<ApiResult<StatusResponse>> {
    return this.core.get(STATUS_PATH);
  }
}
