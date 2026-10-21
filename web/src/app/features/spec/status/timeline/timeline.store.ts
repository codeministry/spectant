import { computed, inject, Injectable, linkedSignal, resource } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import type { TimelineEntry, TimelineKind } from '../../../../../../../core/src/files';
import { ApiClient } from '../../../../core/api.service';
import { ShellState } from '../../../../layout/shell/shell-state.service';
import { specParams, specTabLink } from '../../spec-view';
import { routeFragment, routeQuery } from '../../route-signals';
import { groupByDay, parseKinds, TIMELINE_KINDS } from './timeline-model';

/** The fragment prefix of a deep link to one entry: `#t/<id>`. */
const FRAGMENT = 't/';

/**
 * The state of the Timeline tab (`TimelineTab`, T55, ISC-80, spec 061): the Timeline route's strand, the source
 * filter in `?kinds=`, the day groups it leaves, the deep-linked entry (`#t/<id>`) and which bodies are open. The
 * deep-link scroll stays in the page.
 */
@Injectable()
export class TimelineStore {
  private readonly api = inject(ApiClient);
  private readonly state = inject(ShellState);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  private readonly params = specParams(this.state);
  readonly timeline = resource({ params: () => this.params(), loader: ({ params }) => this.api.timeline(params.ws, params.id) });

  private readonly query = routeQuery(this.route);
  private readonly fragment = routeFragment(this.route);

  /** The pressed sources; empty means every source. */
  readonly selected = computed(() => parseKinds(this.query().get('kinds')));
  /** The entry `#t/<id>` names, or null. */
  readonly target = computed(() => {
    const fragment = this.fragment();
    return fragment?.startsWith(FRAGMENT) ? fragment.slice(FRAGMENT.length) : null;
  });

  private readonly result = computed(() => this.timeline.value());
  readonly entries = computed<readonly TimelineEntry[]>(() => {
    const result = this.result();
    return result?.kind === 'ok' ? result.body : [];
  });
  readonly counts = computed(() => {
    const counts = Object.fromEntries(TIMELINE_KINDS.map((kind) => [kind, 0])) as Record<TimelineKind, number>;
    for (const entry of this.entries()) counts[entry.kind] += 1;
    return counts;
  });
  /** The pills in row order; Worktree only while an entry of it exists or the filter names it (spec 027). */
  readonly shownKinds = computed(() => TIMELINE_KINDS.filter((kind) => kind !== 'worktree' || this.counts().worktree > 0 || this.isPressed(kind)));
  readonly days = computed(() => {
    const selected = this.selected();
    const shown = selected.length === 0 ? this.entries() : this.entries().filter((entry) => selected.includes(entry.kind));
    return groupByDay(shown);
  });

  /** No recorded event yet: every entry is a stage transition derived from the files. */
  readonly derivedOnly = computed(() => {
    const entries = this.entries();
    return entries.length > 0 && entries.every((entry) => entry.derived);
  });

  /** `loading` only before the first answer; a reload keeps the list on screen. */
  readonly view = computed<'loading' | 'ok' | 'empty' | 'unserved' | 'error'>(() => {
    const result = this.result();
    if (result === undefined) return this.timeline.error() ? 'error' : 'loading';
    if (result.kind === 'ok') return result.body.length === 0 ? 'empty' : 'ok';
    if (result.kind === 'not-found' && !result.served) return 'unserved';
    return 'error';
  });

  /** Open bodies by row key; a deep link opens its target. Reset when the spec changes. */
  private readonly open = linkedSignal<ReadonlySet<string>>(() => {
    const target = this.target();
    return new Set(target === null ? [] : [target]);
  });

  readonly boardLink = computed(() => specTabLink(this.state, 'board'));

  isOpen(key: string): boolean {
    return this.open().has(key);
  }

  setOpen(key: string, open: boolean): void {
    this.open.update((keys) => {
      const next = new Set(keys);
      if (open) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  isPressed(kind: TimelineKind): boolean {
    return this.selected().includes(kind);
  }

  /** Toggles one source in `?kinds=`; the last one released drops the param (every source again). */
  toggleKind(kind: TimelineKind): void {
    const selected = new Set(this.selected());
    if (selected.has(kind)) selected.delete(kind);
    else selected.add(kind);
    const kinds = TIMELINE_KINDS.filter((each) => selected.has(each));
    this.setKinds(kinds.length === 0 ? null : kinds.join(','));
  }

  clearKinds(): void {
    this.setKinds(null);
  }

  private setKinds(kinds: string | null): void {
    void this.router.navigate([], { relativeTo: this.route, queryParams: { kinds }, queryParamsHandling: 'merge', preserveFragment: true, replaceUrl: true });
  }

  reload(): void {
    this.timeline.reload();
  }
}
