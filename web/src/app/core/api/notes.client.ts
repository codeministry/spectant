import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { type Note, type NoteCounts, type NoteDraft, type NotesQuery, noteRoutes } from '../../../../../server/src/contracts/note-routes.contract';
import { type ApiResult, codedError, type HttpCore } from './http-core';

/**
 * What a notes write answers (T100, ISC-95), never a thrown exception: the saved note (`POST` 201, `PUT` 200), or the
 * status of anything else (400 with the contract's code, 404 for an unknown note or workspace), 0 when no answer came.
 */
export type NoteWriteResult =
  | { readonly kind: 'ok'; readonly note: Note }
  | { readonly kind: 'error'; readonly status: number; readonly error: string | null };

/** What `DELETE …/notes/:id` answers: 204 is `ok`. */
export type NoteDeleteResult = { readonly kind: 'ok' } | { readonly kind: 'error'; readonly status: number };

/** The Notes area (T100, ISC-95): the workspace's notes, their per-anchor counts, and the three note writes. */
export class NotesClient {
  constructor(private readonly core: HttpCore) {}

  /** The workspace's notes, newest first, narrowed by `query` (`NotesQuery`). */
  notes(ws: string, query?: NotesQuery): Promise<ApiResult<readonly Note[]>> {
    return this.core.get(noteRoutes.list(ws, query));
  }

  /** Per-anchor note counts of one spec (ISC-95): the Claims tab's badge reads a claim's through `noteCountFor` (T101). */
  noteCounts(ws: string, spec: string): Promise<ApiResult<NoteCounts>> {
    return this.core.get(noteRoutes.counts(ws, spec));
  }

  /** `POST …/notes`: 201 with the stored note. The body must not be blank (`empty-body`). */
  async createNote(ws: string, draft: NoteDraft): Promise<NoteWriteResult> {
    try {
      return { kind: 'ok', note: await firstValueFrom(this.core.http.post<Note>(noteRoutes.create(ws), draft)) };
    } catch (failure: unknown) {
      return codedError(failure);
    }
  }

  /** `PUT …/notes/:id`: the draft replaces the stored one whole (anchor, title and body). */
  async updateNote(ws: string, id: string, draft: NoteDraft): Promise<NoteWriteResult> {
    try {
      return { kind: 'ok', note: await firstValueFrom(this.core.http.put<Note>(noteRoutes.update(ws, id), draft)) };
    } catch (failure: unknown) {
      return codedError(failure);
    }
  }

  /** `DELETE …/notes/:id`: 204 without a body. */
  async deleteNote(ws: string, id: string): Promise<NoteDeleteResult> {
    try {
      await firstValueFrom(this.core.http.delete(noteRoutes.remove(ws, id)));
      return { kind: 'ok' };
    } catch (failure: unknown) {
      return { kind: 'error', status: failure instanceof HttpErrorResponse ? failure.status : 0 };
    }
  }
}
