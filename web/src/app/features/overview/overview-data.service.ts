import { computed, inject, Injectable, resource } from '@angular/core';
import { ApiClient, type WorkspaceListEntry } from '../../core/api.service';
import { ShellData } from '../../layout/shell/shell-data.service';
import { type OverviewColumn, readColumn } from './overview-model';

/** One registered workspace on `/`: its column, or why there is none. */
export type OverviewSlot =
  | { readonly kind: 'column'; readonly column: OverviewColumn }
  | { readonly kind: 'unreadable'; readonly entry: WorkspaceListEntry; readonly reason: string | null }
  | { readonly kind: 'loading'; readonly entry: WorkspaceListEntry };

/**
 * Every workspace's dashboard for the overview (T65, ISC-16). The same approach as the palette's `PaletteIndex`: one
 * `resource()` keyed by `ShellData`'s workspace list, loading each readable workspace's dashboard through `ApiClient`
 * in parallel, so a list refresh reloads the columns. A workspace the list marks unreadable, or whose dashboard does
 * not answer `ok`, becomes an `unreadable` slot; no dashboard is asked for it. Provided by the page, so it lives only
 * while `/` is open.
 */
@Injectable()
export class OverviewData {
  private readonly api = inject(ApiClient);
  private readonly shell = inject(ShellData);

  /** The list as served; null while loading, and for any answer but `ok`. */
  readonly list = computed<readonly WorkspaceListEntry[] | null>(() => {
    const result = this.shell.workspaces.value();
    return result?.kind === 'ok' ? result.body : null;
  });
  /** The list request answered, but not `ok`. */
  readonly failed = computed(() => {
    const result = this.shell.workspaces.value();
    return result !== undefined && result.kind !== 'ok';
  });

  private readonly dashboards = resource({
    params: () => {
      const list = this.list();
      return list === null ? undefined : list.filter((entry) => entry.readable);
    },
    loader: async ({ params }) => {
      const answers = await Promise.all(params.map(async (entry) => ({ entry, result: await this.api.dashboard(entry.slug) })));
      const at = Date.now();
      return new Map(
        answers.map(({ entry, result }): [string, OverviewSlot] => [
          entry.slug,
          result.kind === 'ok'
            ? { kind: 'column', column: readColumn(entry, result.body, at) }
            : { kind: 'unreadable', entry, reason: result.kind === 'unavailable' ? result.body.error : null },
        ]),
      );
    },
  });

  /** One slot per registered workspace, in list order. */
  readonly slots = computed<readonly OverviewSlot[]>(() => {
    const loaded = this.dashboards.value();
    return (this.list() ?? []).map((entry): OverviewSlot => {
      if (!entry.readable) return { kind: 'unreadable', entry, reason: entry.error ?? null };
      return loaded?.get(entry.slug) ?? { kind: 'loading', entry };
    });
  });
}
