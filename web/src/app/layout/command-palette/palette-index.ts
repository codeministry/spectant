import { computed, inject, Injectable, resource, signal } from '@angular/core';
import { ApiClient, type DashboardBody } from '../../core/api.service';
import { ShellData } from '../shell/shell-data.service';
import { ShellState } from '../shell/shell-state.service';

/** The few fields of a dashboard row the palette reads; `DashboardBody` is untyped in web (api.service.ts). */
export interface PaletteSpecRow {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly phase: string | null;
  readonly nextCommand: string | null;
}

export interface PaletteArchiveRow {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly archived: string | null;
}

export interface PaletteService {
  readonly port: number;
  readonly url: string;
  readonly label: string | null;
  readonly process: string;
}

/** One readable workspace as the palette lists it. */
export interface PaletteWorkspace {
  readonly slug: string;
  readonly name: string;
  readonly specs: readonly PaletteSpecRow[];
  readonly archive: readonly PaletteArchiveRow[];
  /** Spec IDs in the dashboard's Next up order. */
  readonly nextUp: readonly string[];
  readonly services: readonly PaletteService[];
}

type Loose = Readonly<Record<string, unknown>>;
const isLoose = (value: unknown): value is Loose => typeof value === 'object' && value !== null;
const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const list = (body: unknown, key: string): Loose[] => {
  const value = isLoose(body) ? body[key] : null;
  return Array.isArray(value) ? value.filter(isLoose) : [];
};

/** Reads a dashboard body narrowly; a row without an id is skipped, nothing else is assumed. */
export function readWorkspace(slug: string, name: string, body: DashboardBody): PaletteWorkspace {
  const specs = list(body, 'specs').flatMap((row): PaletteSpecRow[] => {
    const id = text(row['id']);
    if (id === null) return [];
    const title = text(row['title']) ?? id;
    return [{ id, slug: text(row['slug']) ?? id, title, phase: text(row['phase']), nextCommand: text(row['nextCommand']) }];
  });
  const archive = list(body, 'archive').flatMap((row): PaletteArchiveRow[] => {
    const id = text(row['id']);
    if (id === null) return [];
    return [{ id, slug: text(row['slug']) ?? id, title: text(row['title']) ?? id, archived: text(row['archived']) }];
  });
  const next = isLoose(body) ? body['nextUp'] : null;
  const nextUp = Array.isArray(next) ? next.filter((id): id is string => typeof id === 'string') : [];
  const services = list(body, 'services').flatMap((row): PaletteService[] => {
    const port = row['port'];
    const url = text(row['url']);
    if (typeof port !== 'number' || url === null) return [];
    return [{ port, url, label: text(row['label']), process: text(row['process']) ?? '' }];
  });
  return { slug, name, specs, archive, nextUp, services };
}

/**
 * Every readable workspace's dashboard, for the palette's Specs and Archived groups (ISC-60: every spec, not only the
 * open workspace's). Nothing loads before the palette first opens (`want()`); each later open reloads, so the lists
 * are as fresh as the dashboards. The open workspace always comes from `ShellData`'s own dashboard and leads the list.
 */
@Injectable({ providedIn: 'root' })
export class PaletteIndex {
  private readonly api = inject(ApiClient);
  private readonly data = inject(ShellData);
  private readonly state = inject(ShellState);
  private readonly wanted = signal(false);

  /**
   * Keyed on `wanted` alone, so a route or workspace-list change while the palette is closed fetches nothing; the loader
   * reads the list and the open workspace when it runs (on the first open, on each later open and on refresh). The open
   * workspace's dashboard is already in ShellData (`current`), so it is not read a second time.
   */
  private readonly others = resource({
    params: () => (this.wanted() ? true : undefined),
    loader: async () => {
      const open = this.state.ws();
      const targets = this.data
        .workspaceList()
        .filter((entry) => entry.readable && entry.slug !== open)
        .map((entry) => ({ slug: entry.slug, name: entry.name }));
      const answers = await Promise.all(targets.map(async (ws) => ({ ws, result: await this.api.dashboard(ws.slug) })));
      return answers.flatMap(({ ws, result }) => (result.kind === 'ok' ? [readWorkspace(ws.slug, ws.name, result.body)] : []));
    },
  });

  /** The open workspace (when its dashboard answered), then every other readable one in list order. */
  readonly workspaces = computed<readonly PaletteWorkspace[]>(() => {
    const current = this.current();
    const rest = (this.others.value() ?? []).filter((ws) => ws.slug !== current?.slug);
    return current === null ? rest : [current, ...rest];
  });

  /** The open workspace's dashboard as the palette reads it, or null. */
  readonly current = computed<PaletteWorkspace | null>(() => {
    const slug = this.state.ws();
    const result = this.data.dashboard.value();
    if (slug === null || result?.kind !== 'ok') return null;
    return readWorkspace(slug, this.data.workspaceName(slug), result.body);
  });

  /** Called on every open: the first loads, each later one reloads. */
  want(): void {
    if (this.wanted()) this.others.reload();
    else this.wanted.set(true);
  }

  /** Refresh now: the shell's resources and this index. */
  refresh(): void {
    this.data.workspaces.reload();
    this.data.dashboard.reload();
    // The planning tree and the open spec feed the Features / Milestones groups, the breadcrumb and the spec pages.
    this.data.planning.reload();
    this.data.spec.reload();
    if (this.wanted()) this.others.reload();
  }
}
