import { computed, inject, Injectable, Injector, linkedSignal, type Resource, resource, type Signal, signal, untracked } from '@angular/core';
import type { ClaimGlyphState } from '../../../../../core/src/files';
import { ApiClient, type DashboardBody } from '../../core/api.service';
import { isLoose, type Loose, text } from '../shell/loose';
import { RefreshService } from '../shell/refresh.service';
import { ShellData } from '../shell/shell-data.service';
import { ShellState } from '../shell/shell-state.service';

/** The few fields of a dashboard row the palette reads; `DashboardBody` is untyped in web (api.service.ts). */
export interface PaletteSpecRow {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  /** The dashboard row's `stage` (`plan` … `done`), the status the palette shows (spec 064, ISC-501). */
  readonly stage: string | null;
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

/**
 * One claim as the palette's Claims group lists it (T3 · ISC-139), read from core's `ClaimViewModel` (`GET
 * …/specs/:id/claims`) without reshaping: `isc` is the claim ID as written (`ISC-126`), `text` the claim line,
 * `status` the claim view's glyph state (its word is `palette.claimStates.<status>`). The jump target is
 * `/w/<ws>/s/<specId>/claims#claim-<isc>`.
 */
export interface PaletteClaim {
  readonly ws: string;
  readonly specId: string;
  readonly isc: string;
  readonly text: string;
  readonly status: ClaimGlyphState;
}

/** At most this many claim reads run at once while a workspace's claims load (one read per spec). */
export const CLAIM_LOAD_CONCURRENCY = 6;

/**
 * How long the palette's first draw waits for the other workspaces' dashboards (spec 057, ISC-373). Within it the list
 * is drawn once, complete and in its final order (spec 024 T80); a workspace that has not answered by then holds back
 * no other, and joins the drawn list when it answers.
 */
export const OTHERS_WAIT_MS = 500;

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
    return [{ id, slug: text(row['slug']) ?? id, title, stage: text(row['stage']), nextCommand: text(row['nextCommand']) }];
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
 * What a dashboard says about its specs, as one string: equal for two bodies whose spec and archive rows are equal, so
 * a live refresh that changed nothing (an ETag 304, or a 200 with the same rows) reloads no claims, and one that moved
 * a count, a state or a row does.
 */
export function dashboardStamp(body: DashboardBody): string {
  return JSON.stringify([list(body, 'specs'), list(body, 'archive')]);
}

/** Runs `task` over `items` with at most `limit` in flight; results keep the order of `items`. */
async function mapLimited<T, R>(items: readonly T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const at = next++;
      results[at] = await task(items[at]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * Every readable workspace's dashboard, for the palette's Specs and Archived groups (ISC-60: every spec, not only the
 * open workspace's). Nothing loads before the palette first opens (`want()`); each later open reloads, so the lists
 * are as fresh as the dashboards. The open workspace always comes from `ShellData`'s own dashboard and leads the list.
 */
/** One other workspace's answered dashboard, as the palette reads it, and its `dashboardStamp`. */
interface OtherAnswer {
  readonly workspace: PaletteWorkspace;
  readonly stamp: string;
}

/** A source has given its first answer (a value, kept while it reloads, or an error), or has nothing to load. */
const answered = (source: Resource<unknown>): boolean => source.hasValue() || source.status() === 'error' || source.status() === 'idle';

@Injectable({ providedIn: 'root' })
export class PaletteIndex {
  private readonly api = inject(ApiClient);
  private readonly injector = inject(Injector);
  private readonly data = inject(ShellData);
  private readonly refresher = inject(RefreshService);
  private readonly state = inject(ShellState);
  private readonly wanted = signal(false);

  /**
   * The other readable workspaces of the last load, in list order, and each one's last answer (`null`: it failed). A
   * reload keeps an answer until the new one arrives; a workspace gone from the list is dropped when the next load starts.
   */
  private readonly targets = signal<readonly string[]>([]);
  private readonly answers = signal<ReadonlyMap<string, OtherAnswer | null>>(new Map());
  /** Every other workspace of the first load has answered, or `OTHERS_WAIT_MS` ran out; it stays true after. */
  private readonly othersReady = signal(false);
  private loads = 0;

  /** The other workspaces that answered, in list order. */
  private readonly others = computed<readonly OtherAnswer[]>(() => {
    const answers = this.answers();
    return this.targets().flatMap((slug) => answers.get(slug) ?? []);
  });

  /** The open workspace (when its dashboard answered), then every other readable one in list order. */
  readonly workspaces = computed<readonly PaletteWorkspace[]>(() => {
    const current = this.current();
    const rest = this.others()
      .map((other) => other.workspace)
      .filter((ws) => ws.slug !== current?.slug);
    return current === null ? rest : [current, ...rest];
  });

  /** The open workspace's dashboard as the palette reads it, or null. */
  readonly current = computed<PaletteWorkspace | null>(() => {
    const slug = this.state.ws();
    const result = this.data.dashboard.value();
    if (slug === null || result?.kind !== 'ok') return null;
    return readWorkspace(slug, this.data.workspaceName(slug), result.body);
  });

  /** Each known workspace's `dashboardStamp`: the open one from ShellData's dashboard, the others from this index. */
  private readonly stamps = computed<ReadonlyMap<string, string>>(() => {
    const stamps = new Map(this.others().map((other) => [other.workspace.slug, other.stamp] as const));
    const slug = this.state.ws();
    const result = this.data.dashboard.value();
    if (slug !== null && result?.kind === 'ok') stamps.set(slug, dashboardStamp(result.body));
    return stamps;
  });

  private readonly claimSets = new Map<string, Signal<readonly PaletteClaim[] | null>>();
  private readonly claimLoads = new Map<string, Resource<readonly PaletteClaim[] | undefined>>();

  /**
   * Every source of the palette's groups has given its first answer since the first open: the shell's workspaces,
   * dashboard and planning tree, the other workspaces' dashboards and every listed workspace's claims (spec 024 T80).
   * Until then the palette lists nothing, so its list does not grow or re-order under a pointer or a query (a click on
   * Help landed on Library while the other workspaces' specs arrived above it). One other workspace holds the draw back
   * for at most `OTHERS_WAIT_MS` (spec 057, ISC-373): then the ones that answered are drawn, and a late one joins when it
   * answers. Once true it stays true, so a reload, a live refresh or a late workspace does not empty the list again.
   */
  readonly settled = linkedSignal<boolean, boolean>({
    source: () => {
      if (!this.wanted() || !this.othersReady()) return false;
      if (![this.data.workspaces, this.data.dashboard, this.data.planning].every(answered)) return false;
      // Every listed workspace's claims start loading at once; `every` alone would start one per read.
      const loads = this.workspaces().map((ws) => {
        this.claimsFor(ws.slug);
        return this.claimLoads.get(ws.slug);
      });
      return loads.every((load) => load === undefined || answered(load));
    },
    computation: (now, previous) => now || (previous?.value ?? false),
  }).asReadonly();

  /**
   * T3 · ISC-139: every claim of every spec (active, then archived, each in file order) of workspace `ws`, for the
   * palette's Claims group. Lazy: nothing loads before the first call for `ws`, and then only once that workspace's
   * dashboard is known (the open one at once, the others after the palette's first `want()`); until then, and for a
   * workspace no readable dashboard lists, the signal reads `null`. Loading reads `api.claims(ws, id)` per spec, at
   * most `CLAIM_LOAD_CONCURRENCY` at a time; a spec whose read fails is left out. Cached per session: later calls
   * return the same signal, and the claims reload only when the workspace's dashboard changes (`dashboardStamp`), as
   * a live refresh or a palette open finds it; while they reload, the signal keeps the previous list. Safe to call from
   * a `computed` or a template.
   */
  claimsFor(ws: string): Signal<readonly PaletteClaim[] | null> {
    let set = this.claimSets.get(ws);
    if (set === undefined) {
      set = untracked(() => this.claimSet(ws));
      this.claimSets.set(ws, set);
    }
    return set;
  }

  private claimSet(ws: string): Signal<readonly PaletteClaim[] | null> {
    // Its own computed: `stamps` is a new map on every dashboard answer, and only a changed stamp for `ws` may
    // reach the resource's params and start a load.
    const stamp = computed(() => this.stamps().get(ws));
    const loaded = resource({
      injector: this.injector,
      params: () => stamp(),
      loader: async (): Promise<readonly PaletteClaim[]> => {
        const workspace = this.workspaces().find((entry) => entry.slug === ws);
        if (workspace === undefined) return [];
        const ids = [...workspace.specs.map((row) => row.id), ...workspace.archive.map((row) => row.id)];
        const perSpec = await mapLimited(ids, CLAIM_LOAD_CONCURRENCY, async (specId) => {
          const result = await this.api.claims(ws, specId);
          if (result.kind !== 'ok') return [];
          return result.body.claims.map((claim): PaletteClaim => ({ ws, specId, isc: claim.id, text: claim.text, status: claim.state }));
        });
        return perSpec.flat();
      },
    });
    this.claimLoads.set(ws, loaded);
    // `undefined` while a load runs or failed (keep the last list), `null` while the workspace is unknown.
    return linkedSignal<readonly PaletteClaim[] | null | undefined, readonly PaletteClaim[] | null>({
      source: () => (loaded.hasValue() ? loaded.value() : loaded.status() === 'idle' ? null : undefined),
      computation: (now, previous) => (now === undefined ? (previous?.value ?? null) : now),
    }).asReadonly();
  }

  /** Called on every open: the first loads, each later one reloads. */
  want(): void {
    this.wanted.set(true);
    untracked(() => {
      this.loadOthers();
    });
  }

  /**
   * Refresh now: the live refresh (`RefreshService`, the same one the timer and the `r` key call; it reloads the
   * shell's workspaces, dashboard, planning tree and open spec in place) and this index.
   */
  refresh(): void {
    this.refresher.refresh();
    if (this.wanted()) untracked(() => {
      this.loadOthers();
    });
  }

  /**
   * Reads every other readable workspace's dashboard, each answer landing on its own as it arrives (spec 057, ISC-373),
   * never behind one `Promise.all`. It reads the list and the open workspace when it runs (on each open and on refresh),
   * so a route or list change while the palette is closed fetches nothing; the open workspace's dashboard is already in
   * ShellData (`current`) and is not read a second time. An answer of an older load is dropped.
   */
  private loadOthers(): void {
    const load = ++this.loads;
    const open = this.state.ws();
    const targets = this.data.workspaceList().filter((entry) => entry.readable && entry.slug !== open);
    const slugs = targets.map((entry) => entry.slug);
    this.targets.set(slugs);
    this.answers.update((answers) => new Map([...answers].filter(([slug]) => slugs.includes(slug))));
    let waiting = targets.length;
    const answer = (slug: string, value: OtherAnswer | null): void => {
      if (load !== this.loads) return;
      this.answers.update((answers) => new Map(answers).set(slug, value));
      if (--waiting === 0) this.othersReady.set(true);
    };
    if (waiting === 0) this.othersReady.set(true);
    else if (!this.othersReady() && load === 1) {
      setTimeout(() => {
        this.othersReady.set(true);
      }, OTHERS_WAIT_MS);
    }
    for (const { slug, name } of targets) {
      this.api.dashboard(slug).then(
        (result) => {
          answer(slug, result.kind === 'ok' ? { workspace: readWorkspace(slug, name, result.body), stamp: dashboardStamp(result.body) } : null);
        },
        () => {
          answer(slug, null);
        },
      );
    }
  }
}
