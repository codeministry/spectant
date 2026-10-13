import {
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  resource,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import type { ClaimGlyphState, ClaimView, ClaimViewModel } from '../../../../../../../core/src/files';
import { type NoteCounts, noteCountFor } from '../../../../../../../server/src/notes.contract';
import { ApiClient } from '../../../../core/api.service';
import { ShellState } from '../../../../layout/shell/shell-state.service';
import { UiIcon } from '../../../../shared/icons/icon';
import { UiButton } from '../../../../shared/ui/button/button';
import { UiChip } from '../../../../shared/ui/chip/chip';
import { chipIcon } from '../../../../shared/ui/chip/chip-icons';
import { UiEmptyState } from '../../../../shared/ui/empty-state/empty-state';
import { type FilterOption, UiFilterChips } from '../../../../shared/ui/filter-chips/filter-chips';
import { UiIdChip } from '../../../../shared/ui/id-chip/id-chip';
import { type RelativeFormat, UiRelativeTime } from '../../../../shared/ui/relative-time/relative-time';
import { UiRovingItem, UiRovingList } from '../../../../shared/ui/roving-list.directive';
import { UiSectionHeader } from '../../../../shared/ui/section-header/section-header';
import { type Tone, toneMark } from '../../../../shared/ui/tone';

/** The state filter: `open` is the aggregate of open, takeable, taken and blocked, as `counts.open` is (core). */
const STATE_KEYS = ['all', 'open', 'takeable', 'taken', 'blocked', 'closed', 'dropped'] as const;
type StateKey = (typeof STATE_KEYS)[number];
const KIND_KEYS = ['all', 'anti', 'antecedent'] as const;
type KindKey = (typeof KIND_KEYS)[number];

const OPEN_STATES: ReadonlySet<ClaimGlyphState> = new Set(['open', 'takeable', 'taken', 'blocked']);

/** One glyph per state; blocked shares open's ring and adds a chip, taken adds the lock chip and its session
 * (spec 001 prompt 2); the template draws taken as the lucide `lock` (spec 024, prototype `tabClaims`). */
const GLYPH: Record<ClaimGlyphState, string> = {
  open: '○',
  takeable: '◐',
  taken: '◉',
  blocked: '○',
  closed: '●',
  dropped: '⛔',
};

const SEVERITY: Partial<Record<string, Tone>> = { critical: 'error', high: 'error', medium: 'warning', low: 'neutral' };

/** A file a verification line names (`.evidence/isc-5/list.png`), relative to `.evidence/`; null for a command. */
const FILE = /(?:^|[\s`'"(])((?:\.evidence\/)?[\w.-]+(?:\/[\w.-]+)*\.(?:png|jpe?g|webp|gif|svg|txt|log|md|json|html?|pdf|har|pcapng|webm|mp4|zip|csv|xml|ya?ml))(?=$|[\s`'"),.;:])/i;

export function evidenceFile(line: string | null): string | null {
  const match = line === null ? null : FILE.exec(line);
  return match?.[1]?.replace(/^\.evidence\//, '') ?? null;
}

const pick = <T extends string>(keys: readonly T[], value: string | null): T =>
  (keys as readonly string[]).includes(value ?? '') ? (value as T) : keys[0];

interface FeatureGroup {
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
 * The Claims tab (ISC-81): every claim of the spec as a card grouped under its feature heading, with its state glyph,
 * kind, dependency edges, probe row, verification line and note count, filterable by state, kind and search (all in
 * the URL: `?state=takeable&kind=anti&q=…`), the fog list at the end. Counts are the payload's `counts`, never
 * recounted here (ISC-72). `#claim-ISC-…` scrolls to, focuses and highlights its card.
 */
/** A feature group folds its closed claims from this many on, keeping the last `FOLD_KEEP` in view. */
const FOLD_FROM = 6;
const FOLD_KEEP = 3;

@Component({
  selector: 'app-claims-tab',
  imports: [
    NgTemplateOutlet,
    RouterLink,
    TranslocoPipe,
    UiButton,
    UiChip,
    UiEmptyState,
    UiFilterChips,
    UiIcon,
    UiIdChip,
    UiRelativeTime,
    UiRovingItem,
    UiRovingList,
    UiSectionHeader,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-view': 'claims' },
  templateUrl: './claims-tab.html',
  styleUrl: './claims-tab.css',
})
export class ClaimsTab {
  protected readonly chipIcon = chipIcon;
  private readonly api = inject(ApiClient);
  private readonly shell = inject(ShellState);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly transloco = inject(TranslocoService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  protected readonly glyph = GLYPH;
  protected readonly evidenceFile = evidenceFile;

  private readonly query = toSignal(this.route.queryParamMap, { initialValue: this.route.snapshot.queryParamMap });
  private readonly fragment = toSignal(this.route.fragment, { initialValue: this.route.snapshot.fragment });
  // Read by the computeds that translate, so a language switch or the catalogue's arrival re-labels the chips.
  private readonly translation = toSignal(this.transloco.selectTranslation());

  protected readonly state = computed<StateKey>(() => pick(STATE_KEYS, this.query().get('state')));
  protected readonly kind = computed<KindKey>(() => pick(KIND_KEYS, this.query().get('kind')));
  protected readonly search = computed(() => this.query().get('q') ?? '');

  private readonly claims = resource({
    params: () => {
      const ws = this.shell.ws();
      const id = this.shell.specId();
      return ws !== null && id !== null ? { ws, id } : undefined;
    },
    loader: ({ params }) => this.api.claims(params.ws, params.id),
  });

  /** One per-anchor count read per tab load (ISC-95), beside the claims read; the badges look their claim up in it. */
  private readonly noteCounts = resource({
    params: () => {
      const ws = this.shell.ws();
      const id = this.shell.specId();
      return ws !== null && id !== null ? { ws, id } : undefined;
    },
    loader: ({ params }) => this.api.noteCounts(params.ws, params.id),
  });
  private readonly counts = computed<NoteCounts | null>(() => {
    const result = this.noteCounts.hasValue() ? this.noteCounts.value() : undefined;
    return result?.kind === 'ok' ? result.body : null;
  });

  // `value()` throws while the resource is in its error state, so every read goes through `hasValue()` first.
  private readonly result = computed(() => (this.claims.hasValue() ? this.claims.value() : undefined));
  protected readonly model = computed<ClaimViewModel | null>(() => {
    const result = this.result();
    return result?.kind === 'ok' ? result.body : null;
  });
  protected readonly failed = computed(() => {
    const result = this.result();
    return this.claims.error() !== undefined || (result !== undefined && result.kind !== 'ok');
  });

  /** `/w/:ws/s/:id`, the base of every link the cards make. */
  protected readonly base = computed(() => `/w/${this.shell.ws() ?? ''}/s/${this.shell.specId() ?? ''}`);
  protected readonly claimsPath = computed(() => `${this.base()}/claims`);

  protected readonly stateOptions = computed<readonly FilterOption[]>(() => {
    const counts = this.model()?.counts;
    this.translation();
    return STATE_KEYS.map((key) => ({ key, label: this.transloco.translate(`claims.states.${key}`), count: counts?.[key] }));
  });
  protected readonly kindOptions = computed<readonly FilterOption[]>(() => {
    const counts = this.model()?.counts;
    this.translation();
    return KIND_KEYS.map((key) => ({ key, label: this.transloco.translate(`claims.kinds.${key}`), count: counts?.[key] }));
  });

  protected readonly visible = computed<readonly ClaimView[]>(() => {
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

  protected readonly groups = computed<readonly FeatureGroup[]>(() => {
    const model = this.model();
    if (!model) return [];
    const visible = this.visible();
    const known = new Set(model.features.map((f) => f.id));
    // Prototype `.fold`: only the unfiltered All view folds the closed claims; any filter or search shows every match.
    const fold = this.state() === 'all' && this.kind() === 'all' && this.search().trim() === '';
    // Principal 2026-10-13 ("Fold ab 6 geschlossenen"): a group folds only from six closed claims, and its last three
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
  protected readonly target = computed(() => {
    const fragment = this.fragment();
    return fragment?.startsWith('claim-') ? fragment.slice('claim-'.length) : null;
  });

  protected readonly elapsed: RelativeFormat = (value, unit) => {
    const label: string = this.transloco.translate(`claims.units.${unit}`);
    return this.transloco.translate('claims.taken.elapsed', { value, unit: label });
  };

  private scrolledTo: string | null = null;

  constructor() {
    // Scroll to and focus the deep-linked card once it is rendered; a later fragment scrolls again.
    afterRenderEffect(() => {
      const target = this.target();
      this.groups();
      if (target === null || target === this.scrolledTo) return;
      const card = this.host.querySelector<HTMLElement>(`[data-claim="${CSS.escape(target)}"]`);
      if (!card) return;
      this.scrolledTo = target;
      const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
      (card as Partial<HTMLElement>).scrollIntoView?.({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
      card.focus({ preventScroll: true });
    });
  }

  /** The notes anchored to `claim`, 0 until the counts answered or when they failed: no badge rather than a wrong one. */
  protected noteCount(claim: string): number {
    const counts = this.counts();
    return counts === null ? 0 : noteCountFor(counts, { kind: 'claim', spec: counts.spec, id: claim });
  }

  protected severityColor(severity: string): string | null {
    const tone: Tone | undefined = SEVERITY[severity.trim().toLowerCase()];
    return tone ? toneMark(tone) : null;
  }

  /** Backticks as written in spec.md are markup, not text. */
  protected plain(text: string): string {
    return text.replace(/`/g, '');
  }

  protected setState(key: string | undefined): void {
    this.navigate({ state: key === undefined || key === 'all' ? null : key });
  }

  protected setKind(key: string | undefined): void {
    this.navigate({ kind: key === undefined || key === 'all' ? null : key });
  }

  protected setSearch(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.navigate({ q: value.trim() === '' ? null : value }, true);
  }

  protected glyphOf(claim: ClaimView): string {
    return this.glyph[claim.state];
  }

  /** A fold opens on its own when the deep-linked claim sits behind it. */
  protected foldOpen(group: FeatureGroup): boolean {
    const target = this.target();
    return target !== null && group.closed.some((c) => c.id === target);
  }

  protected clear(): void {
    this.navigate({ state: null, kind: null, q: null });
  }

  private navigate(queryParams: Record<string, string | null>, replaceUrl = false): void {
    void this.router.navigate([], { relativeTo: this.route, queryParams, queryParamsHandling: 'merge', replaceUrl });
  }
}
