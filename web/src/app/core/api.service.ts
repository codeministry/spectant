import { HttpClient, HttpHeaders } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { LibraryCatalog, LibraryDoc, WorkflowStage } from '../../../../core/src/files';
import type {
  ActorMapping,
  ActorsRequest,
  BoardQuery,
  Favorites,
  IdeaPage,
  LibraryDocPage,
  LibrarySearchResult,
  ReviewedHashes,
  SpecRouteResponses,
} from '../../../../server/src/contracts/spec-routes.contract';
import type { Note, NoteCounts, NoteDraft, NotesQuery } from '../../../../server/src/contracts/note-routes.contract';
import type { AddWorkspaceRequest, ImageKind } from '../../../../server/src/contracts/workspace-admin.contract';
import { ActorsClient } from './api/actors.client';
import { type ApiResult, HttpCore, type PutResult, type WriteResult } from './api/http-core';
import { LibraryClient, libraryAssetUrl, prototypeUrl } from './api/library.client';
import { type NoteDeleteResult, NotesClient, type NoteWriteResult } from './api/notes.client';
import { type BacklogOp, type PlanningBody, PlanningClient } from './api/planning.client';
import { RunsClient } from './api/runs.client';
import { type EvidenceTextResult, SpecReadsClient, type TasksResult } from './api/spec-reads.client';
import { type GateWriteResult, SpecWritesClient, type TaskCheckResult } from './api/spec-writes.client';
import { WorkspaceAdminClient, type WorkspaceAdminResult, workspaceImageUrl } from './api/workspace-admin.client';
import { type DashboardBody, type WorkspaceListEntry, WorkspacesClient } from './api/workspaces.client';

export { type ApiResult, isRunLocked, type PutResult, type RunLockedWrite, type WriteResult } from './api/http-core';
export type { NoteDeleteResult, NoteWriteResult } from './api/notes.client';
export { type BacklogOp, type PlanningBody, planningUrl } from './api/planning.client';
export type { EvidenceTextResult, TasksResult } from './api/spec-reads.client';
export type { GateWriteResult, TaskCheckResult, TaskCheckWritten } from './api/spec-writes.client';
export type { WorkspaceAdminResult, WorkspaceAdminWrite } from './api/workspace-admin.client';
export { dashboardUrl, type DashboardBody, type WorkspaceListEntry, WORKSPACES_URL } from './api/workspaces.client';

/**
 * The client of the loopback `/api` (T35 seam). Every URL comes from the spec routes contract's builders
 * (`server/src/contracts/spec-routes.contract.ts`, T44) or the two workspace routes beside them; every body is typed
 * with core's types, never re-declared.
 *
 * A facade: the HTTP core (`api/http-core.ts`: the ETag cache, the read, write and put shapes) and one client per API
 * area under `api/` do the work, each method here hands its call to its area's client as it is. The three URL
 * builders (`workspaceImageUrl`, `libraryAssetUrl`, `prototypeUrl`) read no state, so a caller may use them off the
 * prototype, as the library specs do.
 */
@Injectable({ providedIn: 'root' })
export class ApiClient {
  private readonly core = new HttpCore(inject(HttpClient));
  private readonly workspacesApi = new WorkspacesClient(this.core);
  private readonly adminApi = new WorkspaceAdminClient(this.core);
  private readonly runsApi = new RunsClient(this.core);
  private readonly planningApi = new PlanningClient(this.core);
  private readonly libraryApi = new LibraryClient(this.core);
  private readonly actorsApi = new ActorsClient(this.core);
  private readonly specReadsApi = new SpecReadsClient(this.core);
  private readonly specWritesApi = new SpecWritesClient(this.core);
  private readonly notesApi = new NotesClient(this.core);

  /** A GET through the ETag cache (`HttpCore.get`). */
  get<T>(url: string, onHeaders?: (headers: HttpHeaders) => void, notModified = false): Promise<ApiResult<T>> {
    return this.core.get<T>(url, onHeaders, notModified);
  }

  /** Spec 030 (T12, ISC-28): a stream answer into the ETag cache (`HttpCore.prime`). */
  prime(path: string, etag: string, body: unknown): void {
    this.core.prime(path, etag, body);
  }

  workspaces(): Promise<ApiResult<readonly WorkspaceListEntry[]>> {
    return this.workspacesApi.workspaces();
  }

  addWorkspace(request: AddWorkspaceRequest): Promise<WorkspaceAdminResult<'add'>> {
    return this.adminApi.add(request);
  }

  renameWorkspace(ws: string, name: string): Promise<WorkspaceAdminResult<'rename'>> {
    return this.adminApi.rename(ws, name);
  }

  rescanWorkspace(ws: string): Promise<WorkspaceAdminResult<'rescan'>> {
    return this.adminApi.rescan(ws);
  }

  removeWorkspace(ws: string): Promise<WorkspaceAdminResult<'remove'>> {
    return this.adminApi.remove(ws);
  }

  uploadWorkspaceImage(ws: string, kind: ImageKind, file: Blob): Promise<WorkspaceAdminResult<'putImage'>> {
    return this.adminApi.uploadImage(ws, kind, file);
  }

  workspaceImageUrl(ws: string, kind: ImageKind, version: string): string {
    return workspaceImageUrl(ws, kind, version);
  }

  dashboard(ws: string): Promise<ApiResult<DashboardBody>> {
    return this.workspacesApi.dashboard(ws);
  }

  activityHash(ws: string): string | null {
    return this.workspacesApi.activityHash(ws);
  }

  releaseRun(ws: string, run: string, hash: string): Promise<WriteResult<'runRelease'>> {
    return this.runsApi.releaseRun(ws, run, hash);
  }

  planning(ws: string): Promise<ApiResult<PlanningBody>> {
    return this.planningApi.planning(ws);
  }

  spec(ws: string, id: string): Promise<ApiResult<SpecRouteResponses['spec']>> {
    return this.specReadsApi.spec(ws, id);
  }

  specHash(ws: string, id: string): string | null {
    return this.specReadsApi.specHash(ws, id);
  }

  transition(ws: string, id: string, to: WorkflowStage, hash: string): Promise<WriteResult<'transition'>> {
    return this.specWritesApi.transition(ws, id, to, hash);
  }

  allocate(ws: string, slug: string, hash: string): Promise<WriteResult<'allocate'>> {
    return this.planningApi.allocate(ws, slug, hash);
  }

  backlog(ws: string, op: BacklogOp, hash: string): Promise<WriteResult<'backlog'>> {
    return this.planningApi.backlog(ws, op, hash);
  }

  idea(ws: string, slug: string): Promise<ApiResult<IdeaPage>> {
    return this.planningApi.idea(ws, slug);
  }

  library(ws: string): Promise<ApiResult<LibraryCatalog>> {
    return this.libraryApi.library(ws);
  }

  libraryDoc(ws: string, path: string): Promise<ApiResult<LibraryDocPage>> {
    return this.libraryApi.libraryDoc(ws, path);
  }

  librarySearch(ws: string, q: string): Promise<ApiResult<LibrarySearchResult>> {
    return this.libraryApi.librarySearch(ws, q);
  }

  libraryAssetUrl(ws: string, path: string): string {
    return libraryAssetUrl(ws, path);
  }

  prototypeUrl(ws: string, doc: Pick<LibraryDoc, 'path' | 'spec' | 'type' | 'archived'>, page: string): string | null {
    return prototypeUrl(ws, doc, page);
  }

  actors(): Promise<ApiResult<readonly ActorMapping[]>> {
    return this.actorsApi.actors();
  }

  putActors(list: ActorsRequest): Promise<PutResult<readonly ActorMapping[]>> {
    return this.actorsApi.putActors(list);
  }

  boardQuery(ws: string): Promise<ApiResult<BoardQuery>> {
    return this.planningApi.boardQuery(ws);
  }

  putBoardQuery(ws: string, query: string): Promise<PutResult<BoardQuery>> {
    return this.planningApi.putBoardQuery(ws, query);
  }

  favorites(ws: string): Promise<ApiResult<Favorites>> {
    return this.planningApi.favorites(ws);
  }

  putFavorite(ws: string, spec: string): Promise<PutResult<Favorites>> {
    return this.planningApi.putFavorite(ws, spec);
  }

  deleteFavorite(ws: string, spec: string): Promise<PutResult<Favorites>> {
    return this.planningApi.deleteFavorite(ws, spec);
  }

  timeline(ws: string, id: string): Promise<ApiResult<SpecRouteResponses['timeline']>> {
    return this.specReadsApi.timeline(ws, id);
  }

  frames(ws: string, id: string): Promise<ApiResult<SpecRouteResponses['frames']>> {
    return this.specReadsApi.frames(ws, id);
  }

  live(ws: string, id: string): Promise<ApiResult<SpecRouteResponses['live']>> {
    return this.specReadsApi.live(ws, id);
  }

  reviewedHashes(ws: string, id: string): ReviewedHashes | null {
    return this.specReadsApi.reviewedHashes(ws, id);
  }

  gateReviewed(ws: string, id: string, hashes: ReviewedHashes): Promise<GateWriteResult> {
    return this.specWritesApi.gateReviewed(ws, id, hashes);
  }

  claims(ws: string, id: string): Promise<ApiResult<SpecRouteResponses['claims']>> {
    return this.specReadsApi.claims(ws, id);
  }

  evidenceText(ws: string, id: string, path: string): Promise<EvidenceTextResult> {
    return this.specReadsApi.evidenceText(ws, id, path);
  }

  tasks(ws: string, id: string): Promise<TasksResult> {
    return this.specReadsApi.tasks(ws, id);
  }

  taskCheck(ws: string, id: string, tid: string, hash: string, checked: boolean): Promise<TaskCheckResult> {
    return this.specWritesApi.taskCheck(ws, id, tid, hash, checked);
  }

  notes(ws: string, query?: NotesQuery): Promise<ApiResult<readonly Note[]>> {
    return this.notesApi.notes(ws, query);
  }

  noteCounts(ws: string, spec: string): Promise<ApiResult<NoteCounts>> {
    return this.notesApi.noteCounts(ws, spec);
  }

  createNote(ws: string, draft: NoteDraft): Promise<NoteWriteResult> {
    return this.notesApi.createNote(ws, draft);
  }

  updateNote(ws: string, id: string, draft: NoteDraft): Promise<NoteWriteResult> {
    return this.notesApi.updateNote(ws, id, draft);
  }

  deleteNote(ws: string, id: string): Promise<NoteDeleteResult> {
    return this.notesApi.deleteNote(ws, id);
  }
}
