import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import {
  type AddWorkspaceRequest,
  type ImageKind,
  type RenameWorkspaceRequest,
  type WorkspaceAdminErrors,
  type WorkspaceAdminResponses,
  type WorkspaceAdminRouteName,
  workspaceAdminRoutes,
} from '../../../../../server/src/contracts/workspace-admin.contract';
import type { HttpCore } from './http-core';

/** The admin writes of spec 016 (every route of the workspace admin contract but the image read). */
export type WorkspaceAdminWrite = Exclude<WorkspaceAdminRouteName, 'getImage'>;

/**
 * What an admin write answers (spec 016, T13, ISC-303), never a thrown exception:
 *
 * - `ok`: the route's 2xx body (`WorkspaceAdminResponses`; `null` for the 204 of `remove`).
 * - `refused`: a 4xx whose body is one of the route's contract errors (`WorkspaceAdminErrors`), by its kebab-case code;
 *   `duplicate-path` only with the existing entry's `slug`. The page maps the code to its inline text.
 * - `error`: anything else (a 5xx, a body that fits no contract error), status 0 when no answer came.
 */
export type WorkspaceAdminResult<R extends WorkspaceAdminWrite> =
  | { readonly kind: 'ok'; readonly body: WorkspaceAdminResponses[R] }
  | { readonly kind: 'refused'; readonly status: number; readonly body: WorkspaceAdminErrors[R] }
  | { readonly kind: 'error'; readonly status: number };

/** A 4xx body the contract names: an object with a string `error`, and `duplicate-path` with its `slug`. */
const isAdminRefusal = (status: number, body: unknown): boolean => {
  if (status < 400 || status >= 500 || typeof body !== 'object' || body === null) return false;
  const { error, slug } = body as { readonly error?: unknown; readonly slug?: unknown };
  if (typeof error !== 'string') return false;
  return error !== 'duplicate-path' || typeof slug === 'string';
};

/** The loopback URL of a stored image with its version (the contract's `imageUrl`); a URL, not a read. */
export function workspaceImageUrl(ws: string, kind: ImageKind, version: string): string {
  return workspaceAdminRoutes.imageUrl(ws, kind, version);
}

/** The workspace admin of spec 016: add, rename, rescan, remove, and the stored images. Never cached, never retried. */
export class WorkspaceAdminClient {
  constructor(private readonly core: HttpCore) {}

  /**
   * Spec 016 (T13, ISC-303): `POST /api/workspaces` with the directory and an optional display name, as sent (the
   * server trims and refuses a blank path). 201 the new `WorkspaceAdminSummary`; 400 `invalid-path`, 422
   * `not-a-directory` or `duplicate-path` (with the existing slug) are `refused`. Never cached, never retried.
   */
  add(request: AddWorkspaceRequest): Promise<WorkspaceAdminResult<'add'>> {
    return this.admin('add', 'POST', workspaceAdminRoutes.add(), request);
  }

  /** `PATCH /api/workspaces/:ws` with the new name only; slug, `/w/<slug>`, notes and settings stay (ISC-305). */
  rename(ws: string, name: string): Promise<WorkspaceAdminResult<'rename'>> {
    const body: RenameWorkspaceRequest = { name };
    return this.admin('rename', 'PATCH', workspaceAdminRoutes.rename(ws), body);
  }

  /** `POST /api/workspaces/:ws/rescan`, no body: the workspace read afresh, its summary with the new counts (ISC-306). */
  rescan(ws: string): Promise<WorkspaceAdminResult<'rescan'>> {
    return this.admin('rescan', 'POST', workspaceAdminRoutes.rescan(ws), null);
  }

  /** `DELETE /api/workspaces/:ws`: 204, the registry entry and its images gone, the repository untouched (ISC-307). */
  remove(ws: string): Promise<WorkspaceAdminResult<'remove'>> {
    return this.admin('remove', 'DELETE', workspaceAdminRoutes.remove(ws), null);
  }

  /**
   * `PUT /api/workspaces/:ws/images/:kind` with the file's raw bytes (ISC-310, ISC-311): 200 `ImageStored`; 413
   * `too-large` and 415 `unsupported-type` are `refused`. The server decides the type by magic bytes alone.
   */
  uploadImage(ws: string, kind: ImageKind, file: Blob): Promise<WorkspaceAdminResult<'putImage'>> {
    return this.admin('putImage', 'PUT', workspaceAdminRoutes.image(ws, kind), file);
  }

  /** One admin write (spec 016): a 2xx is `ok` with its body, a contract 4xx `refused`, anything else `error`. */
  private async admin<R extends WorkspaceAdminWrite>(
    _route: R,
    method: 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    url: string,
    body: unknown,
  ): Promise<WorkspaceAdminResult<R>> {
    try {
      const response = await firstValueFrom(this.core.http.request<unknown>(method, url, { body, observe: 'response' }));
      return { kind: 'ok', body: (response.body ?? null) as WorkspaceAdminResponses[R] };
    } catch (failure: unknown) {
      if (!(failure instanceof HttpErrorResponse)) return { kind: 'error', status: 0 };
      const answer: unknown = failure.error;
      if (isAdminRefusal(failure.status, answer)) return { kind: 'refused', status: failure.status, body: answer as WorkspaceAdminErrors[R] };
      return { kind: 'error', status: failure.status };
    }
  }
}
