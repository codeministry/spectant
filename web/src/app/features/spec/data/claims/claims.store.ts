import { computed, inject, Injectable, resource } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';
import type { ClaimGlyphState, ClaimView, ClaimViewModel, ItemStateInfo } from '../../../../../../../core/src/files';
import { type NoteCounts, noteCountFor } from '../../../../../../../server/src/contracts/notes.contract';
import { ApiClient } from '../../../../core/api.service';
import { ShellData } from '../../../../layout/shell/shell-data.service';
import { ShellState } from '../../../../layout/shell/shell-state.service';
import type { FilterOption } from '../../../../shared/ui/filter-chips/filter-chips';
import { elapsedText } from '../../../../shared/ui/item-state/duration';
import { blockerTitles, heldWait } from '../../live/board/board-model';
import { specParams } from '../../spec-view';
import { routeFragment, routeQuery } from '../../route-signals';

/** The state filter: `open` is the aggregate of open, takeable, taken and blocked, as `counts.open` is (core). */
const STATE_KEYS = ['all', 'open', 'takeable', 'taken', 'blocked', 'closed', 'dropped'] as const;
type StateKey = (typeof STATE_KEYS)[number];
const KIND_KEYS = ['all', 'anti', 'antecedent'] as const;
type KindKey = (typeof KIND_KEYS)[number];

const OPEN_STATES: ReadonlySet<ClaimGlyphState> = new Set(['open', 'takeable', 'taken', 'blocked']);

/** A feature group folds its closed claims from this many on, keeping the last `FOLD_KEEP` in view. */
const FOLD_FROM = 6;
const FOLD_KEEP = 3;

const pick = <T extends string>(keys: readonly T[], value: string | null): T =>
  (keys as readonly string[]).includes(value ?? '') ? (value as T) : keys[0];

export interface FeatureGroup {
  /** `F2`, or `none` for the claims outside every feature block. */
  readonly key: string;
  readonly id: string | null;
  readonly title: string | null;
  readonly why: string | null;
  /** The cards shown; on the folded All view the feature's claims that are not closed. */
  readonly claims: readonly ClaimView[];
  /** The All view without a search only (prototype `.fold`): the closed claims behind the `+ N more` row. */
  readonly closed: readonly ClaimView[];
}

/**
 * The state of the Claims tab (`ClaimsTab`, ISC-81, spec 061): the Claims route and the per-anchor note counts, the
 * filters as query params (`?state=takeable&kind=anti&q=…`) and the feature groups they leave. Counts are the
 * payload's `counts`, never recounted here (ISC-72). The deep-link scroll stays in the page.
 */
@Injectable()
export class ClaimsStore {
  private readonly api = inject(ApiClient);
  private readonly shell = inject(ShellState);
  private readonly data = inject(ShellData);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly transloco = inject(TranslocoService);

  private readonly query = routeQuery(this.route);
  private readonly fragment = routeFragment(this.route);
  // Read by the computeds that translate, so a language switch or the catalogue's arrival re-labels the chips.
  private readonly translation = toSignal(this.transloco.selectTranslation());

  readonly state = computed<StateKey>(() => pick(STATE_KEYS, this.query().get('state')));
  readonly kind = computed<KindKey>(() => pick(KIND_KEYS, this.query().get('kind')));
  readonly search = computed(() => this.query().get('q') ?? '');

  private readonly params = specParams(this.shell);
  private readonly claims = resource({ params: () => this.params(), loader: ({ params }) => this.api.claims(params.ws, params.id) });

  /** One per-anchor count read per tab load (ISC-95), beside the claims read; the badges look their claim up in it. */
  private readonly noteCounts = resource({ params: () => this.params(), loader: ({ params }) => this.api.noteCounts(params.ws, params.id) });
  private readonly counts = computed<NoteCounts | null>(() => {
    const result = this.noteCounts.hasValue() ? this.noteCounts.value() : undefined;
    return result?.kind === 'ok' ? result.body : null;
  });

  // `value()` throws while the resource is in its error state, so every read goes through `hasValue()` first.
  private readonly result = computed(() => (this.claims.hasValue() ? this.claims.value() : undefined));
  readonly model = computed<ClaimViewModel | null>(() => {
    const result = this.result();
    return result?.kind === 'ok' ? result.body : null;
  });

  /**
   * Spec 040 (T51, ISC-224): each claim's `itemState` as the API serves it, by id; a claim without one (an older
   * payload) keeps the glyph and chips it had. A held lock's detail `taken` only repeats `running`, so the line drops it.
   */
  readonly items = computed<ReadonlyMap<string, ItemStateInfo>>(() => {
    const items = new Map<string, ItemStateInfo>();
    for (const claim of this.model()?.claims ?? []) {
      const item = claim.itemState;
      if (item) items.set(claim.id, item.detail === 'taken' ? { ...item, detail: undefined } : item);
    }
    return items;
  });

  durationOf(elapsedMs: number): string {
    const { key, params } = elapsedText(elapsedMs);
    return this.transloco.translate(key, params);
  }

  readonly failed = computed(() => {
    const result = this.result();
    return this.claims.error() !== undefined || (result !== undefined && result.kind !== 'ok');
  });

  /**
   * Spec 025 (T26, ISC-163): the claims an open spec edge holds (`blocked` with core's `waitsOn`), each with the wait
   * its `waits on NNN` chip shows and the blocker titles; a met edge carries no `waitsOn`, so the chip goes with it.
   */
  readonly heldClaims = computed(() => {
    const known = [...this.data.specRows(), ...this.data.archiveRows()];
    const spec = this.shell.specId() ?? '';
    return new Map(
      (this.model()?.claims ?? []).flatMap((claim) => {
        const blockers = claim.waitsOn ?? [];
        return blockers.length === 0 ? [] : [[claim.id, { wait: heldWait(spec, blockers, known), titles: blockerTitles(blockers, known) }] as const];
      }),
    );
  });
  /** `/w/:ws/s/:id`, the base of every link the cards make. */
  readonly base = computed(() => `/w/${this.shell.ws() ?? ''}/s/${this.shell.specId() ?? ''}`);
  readonly claimsPath = computed(() => `${this.base()}/claims`);

  readonly stateOptions = computed<readonly FilterOption[]>(() => {
    const counts = this.model()?.counts;
    this.translation();
    return STATE_KEYS.map((key) => ({ key, label: this.transloco.translate(`claims.states.${key}`), count: counts?.[key] }));
  });
  readonly kindOptions = computed<readonly FilterOption[]>(() => {
    const counts = this.model()?.counts;
    this.translation();
    return KIND_KEYS.map((key) => ({ key, label: this.transloco.translate(`claims.kinds.${key}`), count: counts?.[key] }));
  });

  readonly visible = computed<readonly ClaimView[]>(() => {
    const model = this.model();
    if (!model) return [];
    const state = this.state();
    const kind = this.kind();
    const needle = this.search().trim().toLowerCase();
    return model.claims.filter(
      (c) =>
        (state === 'all' || c.state === state || (state === 'open' && OPEN_STATES.has(c.state))) &&
        (kind === 'all' || c.kind === kind) &&
        (needle === '' || c.id.toLowerCase().includes(needle) || c.text.toLowerCase().includes(needle)),
    );
  });

  readonly groups = computed<readonly FeatureGroup[]>(() => {
    const model = this.model();
    if (!model) return [];
    const visible = this.visible();
    const known = new Set(model.features.map((f) => f.id));
    // Prototype `.fold`: only the unfiltered All view folds the closed claims; any filter or search shows every match.
    const fold = this.state() === 'all' && this.kind() === 'all' && this.search().trim() === '';
    // Principal 2026-10-13: a group folds only from six closed claims, and its last three
    // closed ones (file order) stay in view, so the click path to a claim (ISC-139.1) keeps its budget.
    const group = (key: string, id: string | null, title: string | null, why: string | null, claims: readonly ClaimView[]): FeatureGroup => {
      const closed = claims.filter((c) => c.state === 'closed');
      if (!fold || closed.length < FOLD_FROM) return { key, id, title, why, claims, closed: [] };
      const folded = new Set(closed.slice(0, -FOLD_KEEP));
      return { key, id, title, why, claims: claims.filter((c) => !folded.has(c)), closed: claims.filter((c) => folded.has(c)) };
    };
    const groups: FeatureGroup[] = model.features.map((f) => group(f.id, f.id, f.title, f.why, visible.filter((c) => c.feature === f.id)));
    groups.push(group('none', null, null, null, visible.filter((c) => c.feature === null || !known.has(c.feature))));
    return groups.filter((g) => g.claims.length + g.closed.length > 0);
  });

  /** The claim a `#claim-ISC-…` fragment names. */
  readonly target = computed(() => {
    const fragment = this.fragment();
    return fragment?.startsWith('claim-') ? fragment.slice('claim-'.length) : null;
  });

  /** The notes anchored to `claim`, 0 until the counts answered or when they failed: no badge rather than a wrong one. */
  noteCount(claim: string): number {
    const counts = this.counts();
    return counts === null ? 0 : noteCountFor(counts, { kind: 'claim', spec: counts.spec, id: claim });
  }

  /** A fold opens on its own when the deep-linked claim sits behind it. */
  foldOpen(group: FeatureGroup): boolean {
    const target = this.target();
    return target !== null && group.closed.some((c) => c.id === target);
  }

  setState(key: string | undefined): void {
    this.navigate({ state: key === undefined || key === 'all' ? null : key });
  }

  setKind(key: string | undefined): void {
    this.navigate({ kind: key === undefined || key === 'all' ? null : key });
  }

  setSearch(value: string): void {
    this.navigate({ q: value.trim() === '' ? null : value }, true);
  }

  clear(): void {
    this.navigate({ state: null, kind: null, q: null });
  }

  private navigate(queryParams: Record<string, string | null>, replaceUrl = false): void {
    void this.router.navigate([], { relativeTo: this.route, queryParams, queryParamsHandling: 'merge', replaceUrl });
  }
}
