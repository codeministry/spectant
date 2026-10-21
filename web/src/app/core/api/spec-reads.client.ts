import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import {
  parseReviewedHashes,
  REVIEWED_HASHES_HEADER,
  type ReviewedHashes,
  SPEC_HASH_HEADER,
  specRoutes,
  type SpecRouteResponses,
  TASKS_HASH_HEADER,
} from '../../../../../server/src/contracts/spec-routes.contract';
import type { ApiResult, HttpCore } from './http-core';

/** The Tasks tab's read (T57): an `ok` carries tasks.md's raw hash, which the checkbox write (T68) sends back. */
export type TasksResult =
  | (Extract<ApiResult<SpecRouteResponses['tasks']>, { readonly kind: 'ok' }> & { readonly hash: string | null })
  | Exclude<ApiResult<SpecRouteResponses['tasks']>, { readonly kind: 'ok' }>;

/** `GET …/evidence/file?path=` read as text: the body, a refusal (403), or any other failure. */
export type EvidenceTextResult =
  | { readonly kind: 'ok'; readonly text: string }
  | { readonly kind: 'refused' }
  | { readonly kind: 'error'; readonly status: number };

/**
 * The reads of one spec (every URL from the spec routes contract's builders, `server/src/contracts/spec-routes.contract.ts`,
 * T44), with the write hashes their headers carry: spec.md's and the reviewed hashes from `GET …/:id`, tasks.md's
 * from `GET …/tasks`.
 */
export class SpecReadsClient {
  private readonly tasksHashes = new Map<string, string | null>();
  private readonly specHashes = new Map<string, ReviewedHashes | null>();
  private readonly specFileHashes = new Map<string, string | null>();

  constructor(private readonly core: HttpCore) {}

  spec(ws: string, id: string): Promise<ApiResult<SpecRouteResponses['spec']>> {
    const url = specRoutes.spec(ws, id);
    return this.core.get(url, (headers) => {
      this.specHashes.set(url, parseReviewedHashes(headers.get(REVIEWED_HASHES_HEADER)));
      this.specFileHashes.set(url, headers.get(SPEC_HASH_HEADER));
    }, true);
  }

  /**
   * The raw spec.md hash `X-Spectant-Spec-Hash` carried on the last `GET …/:id`, 200 or 304 (the server sends it on both;
   * after a live update primed the cache the read is a 304, spec 030), the hash
   * `transition()` sends; null before the spec was read or when the header is absent.
   */
  specHash(ws: string, id: string): string | null {
    return this.specFileHashes.get(specRoutes.spec(ws, id)) ?? null;
  }

  /** T55: the spec's timeline, newest first (`TimelineEntry[]`, ISC-80). */
  timeline(ws: string, id: string): Promise<ApiResult<SpecRouteResponses['timeline']>> {
    return this.core.get(specRoutes.timeline(ws, id));
  }

  /** T81: the board's history, core's `Frame[]` (dispatch and result frames per round, ISC-87), served as it is. */
  frames(ws: string, id: string): Promise<ApiResult<SpecRouteResponses['frames']>> {
    return this.core.get(specRoutes.frames(ws, id));
  }

  /** T81: the board as it stands now, core's `LiveFrame` (carry-forward, tasks.md, locks; ISC-90). */
  live(ws: string, id: string): Promise<ApiResult<SpecRouteResponses['live']>> {
    return this.core.get(specRoutes.live(ws, id));
  }

  /**
   * The hashes `X-Spectant-Reviewed-Hashes` carried on the last 200 of `GET …/:id` (a 304 keeps them: the bytes did
   * not change); null before the spec was read or when the header is absent or malformed. The gate write sends them.
   */
  reviewedHashes(ws: string, id: string): ReviewedHashes | null {
    return this.specHashes.get(specRoutes.spec(ws, id)) ?? null;
  }

  /** The Claims tab (ISC-81): core's `ClaimViewModel`, served as it is. */
  claims(ws: string, id: string): Promise<ApiResult<SpecRouteResponses['claims']>> {
    return this.core.get(specRoutes.claims(ws, id));
  }

  /**
   * One evidence file as text (markdown, plain text, JSON) for the preview. The `path` is the listing's
   * `EvidenceFile.path`, encoded once by the contract's builder and never decoded here (ISC-83). A 403 answers
   * `refused`: the file is shown as an error row, never as a fallback preview.
   */
  async evidenceText(ws: string, id: string, path: string): Promise<EvidenceTextResult> {
    try {
      const text = await firstValueFrom(this.core.http.get(specRoutes.evidenceFile(ws, id, path), { responseType: 'text' }));
      return { kind: 'ok', text };
    } catch (failure: unknown) {
      const status = failure instanceof HttpErrorResponse ? failure.status : 0;
      return status === 403 ? { kind: 'refused' } : { kind: 'error', status };
    }
  }

  /**
   * The Tasks tab (T57); the body is null for a spec without tasks.md. `hash` is `X-Spectant-Tasks-Hash` from the last
   * 200 of this URL (a 304 keeps it: the bytes did not change), null when the header is absent.
   */
  async tasks(ws: string, id: string): Promise<TasksResult> {
    const url = specRoutes.tasks(ws, id);
    const result = await this.core.get<SpecRouteResponses['tasks']>(url, (headers) => {
      this.tasksHashes.set(url, headers.get(TASKS_HASH_HEADER));
    });
    return result.kind === 'ok' ? { ...result, hash: this.tasksHashes.get(url) ?? null } : result;
  }
}
