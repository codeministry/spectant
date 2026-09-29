import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { DocName, DocsPage } from '../../../../core/src/files';
import {
  type DocMissing,
  isUnavailable,
  SPEC_API_ROOT,
  specRoutes,
  type SpecRouteResponses,
  type Unavailable,
} from '../../../../server/src/spec-routes.contract';

/**
 * One entry of `GET /api/workspaces`: the browser-side copy of `WorkspaceSummary` in `server/src/api.ts`. Duplicated
 * on purpose, as `Settings` is: that module imports the server's HTTP layer and `bun:sqlite`, which must not reach the
 * browser bundle. `counts` is core's `DashboardKpis`; typed `unknown` until the dashboard types move to a browser-safe
 * module (see `DashboardBody`).
 */
export interface WorkspaceListEntry {
  readonly slug: string;
  readonly name: string;
  readonly pathTail: string;
  readonly readable: boolean;
  readonly error?: string;
  readonly counts: unknown;
}

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
/**
 * The dashboard body, `DashboardModel` of `core/src/dashboard.ts`. Not imported yet: a type import type-checks that
 * module's whole value graph under the web tsconfig, and `core/src/gates.ts` uses Node's `Buffer` and index-signature
 * dot access, which `tsconfig.app.json` rejects. Needs `DashboardModel` in a pure types module in core (core lane).
 */
export type DashboardBody = unknown;

export type ApiResult<T> =
  | { readonly kind: 'ok'; readonly body: T; readonly etag: string | null; readonly notModified: boolean }
  | { readonly kind: 'not-found'; readonly served: boolean }
  | { readonly kind: 'unavailable'; readonly body: Unavailable }
  | { readonly kind: 'error'; readonly status: number };

/** Relative on purpose: the app talks only to the loopback server that served it, on whatever port (ISC-2). */
export const WORKSPACES_URL = SPEC_API_ROOT;
export const dashboardUrl = (ws: string): string => `${SPEC_API_ROOT}/${encodeURIComponent(ws)}/dashboard`;

/** `GET …/docs/:name`: the page, or the typed 404 saying which doc is absent and whether the spec type has it. */
export type DocsResult = ApiResult<DocsPage> | { readonly kind: 'doc-missing'; readonly body: DocMissing };

const isDocMissing = (body: unknown): body is DocMissing =>
  typeof body === 'object' && body !== null && (body as Partial<DocMissing>).error === 'not-found' &&
  typeof (body as Partial<DocMissing>).doc === 'string' && typeof (body as Partial<DocMissing>).availability === 'object';

const isContractNotFound = (body: unknown): boolean =>
  typeof body === 'object' && body !== null && (body as { error?: unknown }).error === 'not-found';

/**
 * The client of the loopback `/api` (T35 seam). Every URL comes from the spec routes contract's builders
 * (`server/src/spec-routes.contract.ts`, T44) or the two workspace routes beside them; every body is typed with
 * core's types, never re-declared.
 *
 * ETag-aware: the last 200 of each URL is kept with its `ETag`, the next read sends `If-None-Match`, and a 304 answers
 * from that copy, so a poll transfers only a change. RxJS stays here, at the I/O boundary: each call is one promise.
 */
@Injectable({ providedIn: 'root' })
export class ApiClient {
  private readonly http = inject(HttpClient);
  private readonly cache = new Map<string, { readonly etag: string; readonly body: unknown }>();

  async get<T>(url: string): Promise<ApiResult<T>> {
    const cached = this.cache.get(url);
    const headers = cached ? new HttpHeaders({ 'If-None-Match': cached.etag }) : undefined;
    try {
      const response = await firstValueFrom(this.http.get<T>(url, { observe: 'response', headers }));
      const etag = response.headers.get('ETag');
      if (etag === null) this.cache.delete(url);
      else this.cache.set(url, { etag, body: response.body });
      return { kind: 'ok', body: response.body as T, etag, notModified: false };
    } catch (failure: unknown) {
      return this.answer<T>(failure, cached);
    }
  }

  workspaces(): Promise<ApiResult<readonly WorkspaceListEntry[]>> {
    return this.get(WORKSPACES_URL);
  }

  dashboard(ws: string): Promise<ApiResult<DashboardBody>> {
    return this.get(dashboardUrl(ws));
  }

  spec(ws: string, id: string): Promise<ApiResult<SpecRouteResponses['spec']>> {
    return this.get(specRoutes.spec(ws, id));
  }

  /** T55: the spec's timeline, newest first (`TimelineEntry[]`, ISC-80). */
  timeline(ws: string, id: string): Promise<ApiResult<SpecRouteResponses['timeline']>> {
    return this.get(specRoutes.timeline(ws, id));
  }

  /** The Claims tab (ISC-81): core's `ClaimViewModel`, served as it is. */
  claims(ws: string, id: string): Promise<ApiResult<SpecRouteResponses['claims']>> {
    return this.get(specRoutes.claims(ws, id));
  }

  /**
   * A Docs tab page (T59). A 404 whose body is the contract's `DocMissing` answers `doc-missing` with that body, so the
   * tab can say whether the spec's type has the file (`availability`); any other failure answers as `get` does.
   */
  async docs(ws: string, id: string, name: DocName): Promise<DocsResult> {
    try {
      const body = await firstValueFrom(this.http.get<DocsPage>(specRoutes.docs(ws, id, name)));
      return { kind: 'ok', body, etag: null, notModified: false };
    } catch (failure: unknown) {
      const error: unknown = failure instanceof HttpErrorResponse ? failure.error : null;
      if (failure instanceof HttpErrorResponse && failure.status === 404 && isDocMissing(error)) {
        return { kind: 'doc-missing', body: error };
      }
      return this.answer<DocsPage>(failure, undefined);
    }
  }

  private answer<T>(failure: unknown, cached: { readonly etag: string; readonly body: unknown } | undefined): ApiResult<T> {
    if (!(failure instanceof HttpErrorResponse)) return { kind: 'error', status: 0 };
    const status = failure.status;
    const error: unknown = failure.error;
    if (status === 304 && cached) return { kind: 'ok', body: cached.body as T, etag: cached.etag, notModified: true };
    if (status === 404) return { kind: 'not-found', served: isContractNotFound(error) };
    if (status === 409 && isUnavailable(error)) return { kind: 'unavailable', body: error };
    return { kind: 'error', status };
  }
}
