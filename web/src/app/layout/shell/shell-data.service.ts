import { computed, inject, Injectable, resource } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import type { Priority } from '../../../../../core/src/files';
import { specRefMatches } from '../../../../../core/src/spec-ref';
import { type ActorMapping, type BoardQuery, type Favorites, isFavoriteIdea, isFavoriteSpec } from '../../../../../server/src/contracts/spec-routes.contract';
import type { AddWorkspaceRequest, ImageKind } from '../../../../../server/src/contracts/workspace-admin.contract';
import {
  ApiClient,
  type PlanningBody,
  type PutResult,
  type WorkspaceAdminResult,
  type WorkspaceAdminWrite,
  type WorkspaceListEntry,
} from '../../core/api.service';
import { type LiveReading, LockSourceService } from '../../core/lock-source.service';
import { ToastService } from '../../shared/ui/toast/toast';
import { isLoose, text } from './loose';
import { ShellState } from './shell-state.service';

/**
 * The few fields of a dashboard row the shell reads. `DashboardBody` is untyped in web until core's dashboard types
 * move to a browser-safe module (api.service.ts), so the rows are read narrowly here and nothing else is assumed.
 */
export interface SpecRowView {
  readonly id: string;
  readonly title: string;
  readonly type: string | null;
  readonly stage: string;
  /** The dashboard row's phase (`building`, `scoping` …); absent when the row carries none. */
  readonly phase?: string;
  /**
   * The dashboard row's `priority` (P3 for a missing or invalid key); null when the row carries none (archive rows).
   * Optional so hand-built rows in specs need not name it.
   */
  readonly priority?: Priority | null;
  /** The folder name (`002-web-console`); the header's spec pill shows it without the `NNN-` prefix. Absent on hand-built rows. */
  readonly slug?: string;
}

const PRIORITIES: readonly Priority[] = ['P1', 'P2', 'P3', 'P4'];


function rowsOf(body: unknown, key: 'specs' | 'archive'): SpecRowView[] {
  const list = isLoose(body) ? body[key] : null;
  if (!Array.isArray(list)) return [];
  return list.filter(isLoose).flatMap((row) => {
    const id = text(row['id']);
    if (id === null) return [];
    const stage = text(row['stage']) ?? (key === 'archive' ? 'done' : 'plan');
    const priority = PRIORITIES.find((level) => level === row['priority']) ?? null;
    const slug = text(row['slug']);
    const phase = text(row['phase']);
    return [
      {
        id,
        title: text(row['title']) ?? id,
        type: text(row['type']),
        stage,
        priority,
        ...(slug === null ? {} : { slug }),
        ...(phase === null ? {} : { phase }),
      },
    ];
  });
}

/** A story of the dashboard's `ideas.list` as the header's spec select names it (spec 064, T54). */
export type IdeaFavoriteView = Readonly<{ slug: string; title: string }>;

/** The dashboard body's `ideas.list`, slug and title only (the slug for a story without a title); rows without a slug drop. */
function ideasOf(body: unknown): IdeaFavoriteView[] {
  const ideas = isLoose(body) ? body['ideas'] : null;
  const list = isLoose(ideas) ? ideas['list'] : null;
  if (!Array.isArray(list)) return [];
  return list.filter(isLoose).flatMap((row) => {
    const slug = text(row['slug']);
    const title = text(row['title']);
    return slug === null ? [] : [{ slug, title: title === null || title === '' ? slug : title }];
  });
}

/** Which set of the `Favorites` answer a star writes: the spec folders or the story slugs. */
type FavoriteKind = keyof Favorites;

/**
 * What the shell loads (T35): the workspace list, the open workspace's dashboard and planning tree (T22, spec 003) and
 * the open spec, each a `resource()` over `ApiClient`, so a route change
 * reloads only what it names. The spec payload's `areas.live` feeds
 * `LockSourceService`; while the spec route is not served yet (a catch-all 404) the reading stays null, source `none`.
 */
@Injectable({ providedIn: 'root' })
export class ShellData {
  private readonly api = inject(ApiClient);
  private readonly state = inject(ShellState);
  private readonly toast = inject(ToastService);
  private readonly transloco = inject(TranslocoService);

  readonly workspaces = resource({ loader: () => this.api.workspaces() });

  readonly dashboard = resource({
    params: () => this.state.ws() ?? undefined,
    loader: ({ params }) => this.api.dashboard(params),
  });

  /** The planning tree (spec 003): keyed by the workspace like `dashboard`, so a route change reloads it. */
  readonly planning = resource({
    params: () => this.state.ws() ?? undefined,
    loader: ({ params }) => this.api.planning(params),
  });

  /**
   * The actor names (spec 008, T112): the whole `ActorMapping` list, loaded once for the app; `saveActors` reloads it
   * after an accepted `PUT`, so every chip renders the names as stored.
   */
  readonly actors = resource({ loader: () => this.api.actors() });

  /** The open workspace's remembered board query (spec 008, T112), keyed like `planning`. */
  readonly boardQuery = resource({
    params: () => this.state.ws() ?? undefined,
    loader: ({ params }) => this.api.boardQuery(params),
  });

  /**
   * The open workspace's favourite specs (spec 052, T10, ISC-300), keyed like `boardQuery`. Its value is the one set
   * every star reads, so a click in one place shows in all three without a reload; `toggleFavorite` writes it.
   */
  readonly favorites = resource({
    params: () => this.state.ws() ?? undefined,
    loader: ({ params }) => this.api.favorites(params),
  });

  readonly spec = resource({
    params: () => {
      const ws = this.state.ws();
      const id = this.state.specId();
      return ws !== null && id !== null ? { ws, id } : undefined;
    },
    loader: ({ params }) => this.api.spec(params.ws, params.id),
  });

  readonly workspaceList = computed<readonly WorkspaceListEntry[]>(() => {
    const result = this.workspaces.value();
    return result?.kind === 'ok' ? result.body : [];
  });

  /** The open workspace's stored logo and screenshot URLs (spec 016) from the list; null per kind without one. */
  readonly wsImages = computed(() => {
    const ws = this.state.ws();
    const entry = ws === null ? undefined : this.workspaceList().find((item) => item.slug === ws);
    return { logo: entry?.images?.logo ?? null, screenshot: entry?.images?.screenshot ?? null };
  });

  /** Active specs in the dashboard's row order (the order `[` / `]` walk). */
  readonly specRows = computed(() => {
    const result = this.dashboard.value();
    return result?.kind === 'ok' ? rowsOf(result.body, 'specs') : [];
  });
  readonly archiveRows = computed(() => {
    const result = this.dashboard.value();
    return result?.kind === 'ok' ? rowsOf(result.body, 'archive') : [];
  });
  readonly specOrder = computed(() => this.specRows().map((row) => row.id));

  /** The open spec's row, active or archived; null before the dashboard answers or when the id is unknown. */
  readonly currentRow = computed<SpecRowView | null>(() => {
    const id = this.state.specId();
    if (id === null) return null;
    return this.specRows().find((row) => row.id === id) ?? this.archiveRows().find((row) => row.id === id) ?? null;
  });

  /** The server said the workspace does not exist (the contract's 404, not the catch-all). */
  readonly workspaceMissing = computed(() => {
    const result = this.dashboard.value();
    return result?.kind === 'not-found' && result.served;
  });
  readonly workspaceUnavailable = computed(() => this.dashboard.value()?.kind === 'unavailable');

  /** The planning body as served; null while loading and for every answer but `ok`. */
  readonly planningModel = computed(() => {
    const result = this.planning.value();
    return result?.kind === 'ok' ? result.body : null;
  });
  /**
   * The Milestones page exists only when a spec names a milestone (spec 003). "No spec carries one" is every entry
   * holding no spec, not an empty list: a block entry no spec names is a 0/0 row and must not reveal the page.
   */
  readonly hasMilestones = computed(() => this.planningModel()?.milestones.some((entry) => entry.specs.length > 0) ?? false);
  /** The server said the workspace does not exist (the contract's 404, not the catch-all). */
  readonly planningMissing = computed(() => {
    const result = this.planning.value();
    return result?.kind === 'not-found' && result.served;
  });
  readonly planningUnavailable = computed(() => this.planning.value()?.kind === 'unavailable');

  /** The workspace's workflow as the planning tree carries it (spec 008); null until it answers `ok`. */
  readonly workflow = computed<PlanningBody['workflow'] | null>(() => this.planningModel()?.workflow ?? null);
  /** The board's columns in board order (`boardStages`), as served; empty until the planning tree answers `ok`. */
  readonly stages = computed<PlanningBody['stages']>(() => this.planningModel()?.stages ?? []);
  /** The count per board column as served (a column without specs may be absent); empty until `ok`. */
  readonly stageCounts = computed<PlanningBody['stageCounts']>(() => this.planningModel()?.stageCounts ?? {});
  /** Every story of `specs/ideas/`, in file-name order, as served; empty until `ok`. */
  readonly ideas = computed<PlanningBody['ideas']>(() => this.planningModel()?.ideas ?? []);

  /** The actor names as stored; empty while loading and for every answer but `ok` (a failed route included). */
  readonly actorList = computed<readonly ActorMapping[]>(() => {
    const result = this.actors.hasValue() ? this.actors.value() : undefined;
    return result?.kind === 'ok' ? result.body : [];
  });

  /** The open workspace's stored board query (`''` when none is stored); null without a workspace or an `ok` answer. */
  readonly boardQueryText = computed<string | null>(() => {
    const result = this.boardQuery.hasValue() ? this.boardQuery.value() : undefined;
    return result?.kind === 'ok' ? result.body.query : null;
  });

  /**
   * The favourite spec folders (`NNN-slug`) of the open workspace as stored, ids the dashboard no longer lists
   * included; empty without a workspace, while loading and for every answer but `ok` (a failed route included).
   */
  readonly favoriteIds = computed<ReadonlySet<string>>(() => new Set(this.favoriteBody()?.specs ?? []));
  /** Spec 064 (T53, ISC-497): the favourite story slugs of the open workspace as stored, read like `favoriteIds`. */
  readonly favoriteIdeaSlugs = computed<ReadonlySet<string>>(() => new Set(this.favoriteBody()?.ideas ?? []));
  /** Spec 064 (T54, ISC-498): the favourite stories in `ideas.list` order; a slug the dashboard lists no story for drops. */
  readonly favoriteIdeas = computed<readonly IdeaFavoriteView[]>(() => {
    const slugs = this.favoriteIdeaSlugs();
    const result = this.dashboard.value();
    return result?.kind === 'ok' ? ideasOf(result.body).filter((idea) => slugs.has(idea.slug)) : [];
  });

  /**
   * The favourite rows the header's spec select lists (spec 052, T11, ISC-302): `specRows` filtered to the favourite
   * folders, in its order. An archived, deleted or renamed spec is no row of `specRows`, so its stored id drops out
   * here and `favoriteRows().length === 0` is the empty state even while stale ids are stored.
   */
  readonly favoriteRows = computed<readonly SpecRowView[]>(() => {
    const ids = this.favoriteIds();
    return this.specRows().filter((row) => ids.has(row.slug ?? row.id));
  });

  /** Whether the spec folder `spec` is a favourite of the open workspace; reactive, a star's `pressed` reads it. */
  isFavorite(spec: string): boolean {
    return this.favoriteIds().has(spec);
  }

  /**
   * Stars or unstars the spec folder `spec` (`NNN-slug`) in the open workspace (spec 052, T10, ISC-300), optimistically:
   * the set flips at once, then the `PUT` or `DELETE` runs and its answer, the whole set as stored, replaces the
   * local one. On a failure only this spec flips back, so a star another click set meanwhile survives, and the toast
   * says `favorites.failed`. An answer landing after the workspace changed is dropped: the new workspace's set loads
   * on its own. Without a workspace, or for an id that is no spec folder, nothing is sent. Resolves true when the
   * server accepted the write.
   */
  async toggleFavorite(spec: string): Promise<boolean> {
    if (!isFavoriteSpec(spec)) return false;
    return this.toggleIn('specs', spec, (ws, on) => (on ? this.api.putFavorite(ws, spec) : this.api.deleteFavorite(ws, spec)));
  }

  /** Whether the story `slug` is a favourite of the open workspace (spec 064, T53); reactive like `isFavorite`. */
  isIdeaFavorite(slug: string): boolean {
    return this.favoriteIdeaSlugs().has(slug);
  }

  /** Stars or unstars the story `slug` as `toggleFavorite` does a spec (spec 064, T53, ISC-497); the spec set stays. */
  async toggleIdeaFavorite(slug: string): Promise<boolean> {
    if (!isFavoriteIdea(slug)) return false;
    return this.toggleIn('ideas', slug, (ws, on) => (on ? this.api.putIdeaFavorite(ws, slug) : this.api.deleteIdeaFavorite(ws, slug)));
  }

  /** The optimistic flip, write and revert both toggles share; only the `kind` set changes, the other stays as it is. */
  private async toggleIn(kind: FavoriteKind, id: string, write: (ws: string, on: boolean) => Promise<PutResult<Favorites>>): Promise<boolean> {
    const ws = this.state.ws();
    if (ws === null) return false;
    const star = !this.favoriteBody()?.[kind].includes(id);
    this.setFavorites(kind, this.flipped(kind, id, star));
    const result = await write(ws, star);
    if (this.state.ws() !== ws) return result.kind === 'ok';
    if (result.kind === 'ok') {
      this.setFavorites(kind, result.body[kind]);
      return true;
    }
    this.setFavorites(kind, this.flipped(kind, id, !star));
    this.toast.show(this.transloco.translate('favorites.failed'));
    return false;
  }

  /** The `ok` favourites answer as last set or read; null without one. */
  private favoriteBody(): Favorites | null {
    const result = this.favorites.hasValue() ? this.favorites.value() : undefined;
    return result?.kind === 'ok' ? result.body : null;
  }

  /** The current `kind` set with `id` in it (`on`) or not, sorted as the server sorts it. */
  private flipped(kind: FavoriteKind, id: string, on: boolean): string[] {
    const ids = new Set(this.favoriteBody()?.[kind] ?? []);
    if (on) ids.add(id);
    else ids.delete(id);
    return [...ids].sort();
  }

  /** A local value of the `favorites` resource; the client's ETag cache for the route stays as the last read left it. */
  private setFavorites(kind: FavoriteKind, ids: readonly string[]): void {
    const last = this.favoriteBody() ?? { specs: [], ideas: [] };
    this.favorites.set({ kind: 'ok', body: { ...last, [kind]: ids }, etag: null, notModified: false });
  }

  /**
   * Spec 016 (T13, ISC-303): the workspace admin writes. Each accepted one reloads `workspaces`, the one resource the
   * header's workspace menu, the overview and `/settings/workspaces` read, so a new, renamed or removed entry shows
   * everywhere without a restart; a refused or failed write leaves it as it is.
   */
  addWorkspace(request: AddWorkspaceRequest): Promise<WorkspaceAdminResult<'add'>> {
    return this.reloading(this.api.addWorkspace(request));
  }

  renameWorkspace(ws: string, name: string): Promise<WorkspaceAdminResult<'rename'>> {
    return this.reloading(this.api.renameWorkspace(ws, name));
  }

  rescanWorkspace(ws: string): Promise<WorkspaceAdminResult<'rescan'>> {
    return this.reloading(this.api.rescanWorkspace(ws));
  }

  removeWorkspace(ws: string): Promise<WorkspaceAdminResult<'remove'>> {
    return this.reloading(this.api.removeWorkspace(ws));
  }

  uploadWorkspaceImage(ws: string, kind: ImageKind, file: Blob): Promise<WorkspaceAdminResult<'putImage'>> {
    return this.reloading(this.api.uploadWorkspaceImage(ws, kind, file));
  }

  private async reloading<R extends WorkspaceAdminWrite>(write: Promise<WorkspaceAdminResult<R>>): Promise<WorkspaceAdminResult<R>> {
    const result = await write;
    if (result.kind === 'ok') this.workspaces.reload();
    return result;
  }

  /** `PUT /api/actors` with the whole list; on an accepted answer the `actors` resource reloads. */
  async saveActors(list: readonly ActorMapping[]): Promise<PutResult<readonly ActorMapping[]>> {
    const result = await this.api.putActors(list);
    if (result.kind === 'ok') this.actors.reload();
    return result;
  }

  /**
   * Stores the board URL's query for the open workspace. The accepted answer is the query as stored, so it becomes
   * the resource's value without a second read; without a workspace nothing is sent (`error`, status 0).
   */
  async saveBoardQuery(query: string): Promise<PutResult<BoardQuery>> {
    const ws = this.state.ws();
    if (ws === null) return { kind: 'error', status: 0, error: null };
    const result = await this.api.putBoardQuery(ws, query);
    if (result.kind === 'ok' && this.state.ws() === ws) this.boardQuery.set({ kind: 'ok', body: result.body, etag: null, notModified: false });
    return result;
  }

  /**
   * The open spec does not exist (ISC-71): the spec route answered the contract's 404, the workspace is unknown, or
   * the dashboard answered and lists the id neither as active nor as archived. Unknown while loading: false.
   */
  readonly specMissing = computed(() => {
    const id = this.state.specId();
    if (id === null) return false;
    const spec = this.spec.value();
    if (spec?.kind === 'not-found' && spec.served) return true;
    if (this.workspaceMissing()) return true;
    return this.specExists(id) === false;
  });

  /** The spec route is not served yet (the server's catch-all 404): views render their placeholder. */
  readonly specRouteUnserved = computed(() => {
    const spec = this.spec.value();
    return spec?.kind === 'not-found' && !spec.served;
  });

  readonly live = computed<LiveReading | null>(() => {
    const spec = this.spec.value();
    return spec?.kind === 'ok' ? spec.body.areas.live : null;
  });

  constructor() {
    inject(LockSourceService).connect(this.live);
  }

  /**
   * Whether the open workspace's dashboard lists the spec `id` names, active or archived; null until it answers `ok`.
   * `id` is any ref the server's `resolveSpec` accepts: the number, the folder or the bare slug (core's `specRefMatches`
   * on the row's folder; a hand-built row without one matches by number).
   */
  specExists(id: string): boolean | null {
    if (this.dashboard.value()?.kind !== 'ok') return null;
    const names = (row: SpecRowView): boolean => row.id === id || (row.slug !== undefined && specRefMatches(row.slug, id));
    return this.specRows().some(names) || this.archiveRows().some(names);
  }

  workspaceName(slug: string): string {
    return this.workspaceList().find((entry) => entry.slug === slug)?.name ?? slug;
  }
}
