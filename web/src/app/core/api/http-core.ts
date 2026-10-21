import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { isUnavailable, type Unavailable } from '../../../../../server/src/contracts/spec-routes.contract';
import { type RunLocked, type WriteAnswer, writeAnswerOf, type WriteOperation } from '../../../../../server/src/contracts/writes.contract';

/**
 * What a read answers, never a thrown exception: a template branches on `kind`.
 *
 * - `ok`: 200, or 304 answered from the ETag cache (`notModified`).
 * - `not-found`: 404. `served` tells the contract's `{error: "not-found"}` (an unknown workspace, spec or doc: the
 *   answer is authoritative, the page shows "not found", ISC-71) from the server's catch-all `{error: "not found"}`
 *   for a path no route answers yet (a spec route before T45 lands: the page renders its placeholder).
 * - `unavailable`: 409 with the workspace's own summary; its directory cannot be read.
 * - `error`: anything else, status 0 when the request never got an answer.
 */
export type ApiResult<T> =
  | { readonly kind: 'ok'; readonly body: T; readonly etag: string | null; readonly notModified: boolean }
  | { readonly kind: 'not-found'; readonly served: boolean }
  | { readonly kind: 'unavailable'; readonly body: Unavailable }
  | { readonly kind: 'error'; readonly status: number };

/**
 * What a spec 008 write answers (T111, ISC-130), never a thrown exception: the contract's `WriteAnswer` when the body
 * fits its status (`writeAnswerOf`, the one validator the server's tests pin too), else `error` with the status: a
 * 403, 404 or 405 of the route layer, a body that does not fit (a 200 included), 0 when no answer came.
 */
export type WriteResult<R extends WriteOperation> =
  | { readonly kind: 'answer'; readonly answer: WriteAnswer<R> }
  | (R extends RunLockedWrite ? { readonly kind: 'run-locked'; readonly body: RunLocked } : never)
  | { readonly kind: 'error'; readonly status: number };

/**
 * The writes a running run on their item refuses with 423 `run-locked` (spec 040, T56, ISC-225.1): the stage move and
 * the allocation. The backlog write belongs to no item and the run release reads no run lock; neither answers it. `WriteAnswer` keeps its 423 arm for the
 * claim lock (`Locked`, read as `body.lock`); the run's 423 is its own result kind, so no caller takes one for the
 * other.
 */
export type RunLockedWrite = Exclude<WriteOperation, 'backlog' | 'runRelease'>;

/** The 423 body of a running run (`RunLocked`, `runLockedOf` in the writes contract): the run, its command, actor and start. */
export const isRunLocked = (body: unknown): body is RunLocked => {
  if (typeof body !== 'object' || body === null) return false;
  const b = body as Partial<Record<keyof RunLocked, unknown>>;
  const actor = b.actor as { readonly id?: unknown; readonly raw?: unknown } | null | undefined;
  return (
    b.error === 'run-locked' &&
    typeof b.run === 'string' &&
    (b.command === null || typeof b.command === 'string') &&
    typeof b.since === 'string' &&
    typeof actor === 'object' &&
    actor !== null &&
    typeof actor.id === 'string' &&
    typeof actor.raw === 'string'
  );
};

/**
 * What a `PUT` of a stored setting answers (the actor names, the board query): the body as stored when it fits the
 * contract's validator, else `error` with the status and the contract's code (`invalid-body`, `not-found`), status 0
 * when no answer came.
 */
export type PutResult<T> =
  | { readonly kind: 'ok'; readonly body: T }
  | { readonly kind: 'error'; readonly status: number; readonly error: string | null };

/** The error shape of a coded write (a note, a stored setting): the status and the contract's `error` code, if any. */
export const codedError = (failure: unknown): { readonly kind: 'error'; readonly status: number; readonly error: string | null } => {
  if (!(failure instanceof HttpErrorResponse)) return { kind: 'error', status: 0, error: null };
  const body: unknown = failure.error;
  const code = typeof body === 'object' && body !== null ? (body as { error?: unknown }).error : undefined;
  return { kind: 'error', status: failure.status, error: typeof code === 'string' ? code : null };
};

/** A body that is the contract's error `error` (`{error}`), e.g. `hash-mismatch` or `locked`. */
export const isContractError = (body: unknown, error: string): boolean =>
  typeof body === 'object' && body !== null && (body as { error?: unknown }).error === error;

type Cached = { readonly etag: string; readonly body: unknown };

/**
 * The HTTP core of `ApiClient` (T35 seam): the one `HttpClient`, the ETag cache, and the shared read, write and put
 * shapes every area client goes through.
 *
 * ETag-aware: the last 200 of each URL is kept with its `ETag`, the next read sends `If-None-Match`, and a 304 answers
 * from that copy, so a poll transfers only a change. RxJS stays here, at the I/O boundary: each call is one promise.
 * The write hashes (activity, spec, reviewed, tasks) are taken from read headers by the area clients, through
 * `onHeaders`.
 */
export class HttpCore {
  private readonly cache = new Map<string, Cached>();

  constructor(readonly http: HttpClient) {}

  /**
   * A GET through the ETag cache. `onHeaders` sees the headers of a 200; with `notModified` set it sees those of a 304
   * too, for a header the server sends on both (the dashboard's activity hash, which can move while the body stays).
   */
  async get<T>(url: string, onHeaders?: (headers: HttpHeaders) => void, notModified = false): Promise<ApiResult<T>> {
    const cached = this.cache.get(url);
    const headers = cached ? new HttpHeaders({ 'If-None-Match': cached.etag }) : undefined;
    try {
      const response = await firstValueFrom(this.http.get<T>(url, { observe: 'response', headers }));
      const etag = response.headers.get('ETag');
      onHeaders?.(response.headers);
      if (etag === null) this.cache.delete(url);
      else this.cache.set(url, { etag, body: response.body });
      return { kind: 'ok', body: response.body as T, etag, notModified: false };
    } catch (failure: unknown) {
      if (notModified && failure instanceof HttpErrorResponse && failure.status === 304) onHeaders?.(failure.headers);
      return this.answer<T>(failure, cached);
    }
  }

  /**
   * Spec 030 (T12, ISC-28): put a stream answer (`LiveView` of the live update stream) into the ETag cache as if a
   * `GET` on `path` had answered it, replacing any older entry, so the next read sends `If-None-Match: etag` and a 304
   * answers `body`. `path` is the read route's request path, the key `get()` uses for the same request.
   */
  prime(path: string, etag: string, body: unknown): void {
    this.cache.set(path, { etag, body });
  }

  /**
   * A write's answer through the contract's `writeAnswerOf`: the status and body of a 2xx or an error alike. A 423
   * `run-locked` of the stage move or the allocation, which `writeAnswerOf` does not fit, is `run-locked` with the run
   * (spec 040, T56, ISC-225.1).
   */
  async write<R extends WriteOperation>(route: R, url: string, body: unknown, headers?: HttpHeaders): Promise<WriteResult<R>> {
    let status: number;
    let answer: unknown;
    try {
      const response = await firstValueFrom(this.http.post<unknown>(url, body, { observe: 'response', headers }));
      status = response.status;
      answer = response.body;
    } catch (failure: unknown) {
      if (!(failure instanceof HttpErrorResponse)) return { kind: 'error', status: 0 };
      status = failure.status;
      answer = failure.error;
    }
    const typed = writeAnswerOf(route, status, answer);
    if (typed !== null) return { kind: 'answer', answer: typed };
    if (status === 423 && route !== 'backlog' && route !== 'runRelease' && isRunLocked(answer)) return { kind: 'run-locked', body: answer } as WriteResult<R>;
    return { kind: 'error', status };
  }

  /**
   * A `PUT` (or, for a favourite, a bodiless `DELETE`) whose 200 body must pass the contract's validator `fits`;
   * anything else is an `error`.
   */
  async put<T>(url: string, body: unknown, fits: (value: unknown) => value is T, method: 'PUT' | 'DELETE' = 'PUT'): Promise<PutResult<T>> {
    try {
      const request = method === 'PUT' ? this.http.put<unknown>(url, body, { observe: 'response' }) : this.http.delete<unknown>(url, { observe: 'response' });
      const response = await firstValueFrom(request);
      return fits(response.body) ? { kind: 'ok', body: response.body } : { kind: 'error', status: response.status, error: null };
    } catch (failure: unknown) {
      return codedError(failure);
    }
  }

  private answer<T>(failure: unknown, cached: Cached | undefined): ApiResult<T> {
    if (!(failure instanceof HttpErrorResponse)) return { kind: 'error', status: 0 };
    const status = failure.status;
    const error: unknown = failure.error;
    if (status === 304 && cached) return { kind: 'ok', body: cached.body as T, etag: cached.etag, notModified: true };
    if (status === 404) return { kind: 'not-found', served: isContractError(error, 'not-found') };
    if (status === 409 && isUnavailable(error)) return { kind: 'unavailable', body: error };
    return { kind: 'error', status };
  }
}
