import { computed, inject, Injectable, resource } from '@angular/core';
import { ApiClient, type WorkspaceListEntry } from '../../core/api.service';
import { type LiveReading, LockSourceService } from '../../core/lock-source.service';
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
}

type Loose = Readonly<Record<string, unknown>>;
const isLoose = (value: unknown): value is Loose => typeof value === 'object' && value !== null;
const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);

function rowsOf(body: unknown, key: 'specs' | 'archive'): SpecRowView[] {
  const list = isLoose(body) ? body[key] : null;
  if (!Array.isArray(list)) return [];
  return list.filter(isLoose).flatMap((row) => {
    const id = text(row['id']);
    if (id === null) return [];
    const stage = text(row['stage']) ?? (key === 'archive' ? 'done' : 'plan');
    return [{ id, title: text(row['title']) ?? id, type: text(row['type']), stage }];
  });
}

/**
 * What the shell loads (T35): the workspace list, the open workspace's dashboard and planning tree (T22, spec 003) and
 * the open spec, each a `resource()` over `ApiClient`, so a route change reloads only what it names. The spec payload's `areas.live` feeds
 * `LockSourceService`; while the spec route is not served yet (a catch-all 404) the reading stays null, source `none`.
 */
@Injectable({ providedIn: 'root' })
export class ShellData {
  private readonly api = inject(ApiClient);
  private readonly state = inject(ShellState);

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

  /** Whether the open workspace's dashboard lists `id`, active or archived; null until it answers `ok`. */
  specExists(id: string): boolean | null {
    if (this.dashboard.value()?.kind !== 'ok') return null;
    return this.specRows().some((row) => row.id === id) || this.archiveRows().some((row) => row.id === id);
  }

  workspaceName(slug: string): string {
    return this.workspaceList().find((entry) => entry.slug === slug)?.name ?? slug;
  }
}
