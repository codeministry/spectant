import { ChangeDetectionStrategy, Component, computed, contentChildren, effect, inject, input, output, viewChildren } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { UiClamp } from '../../../shared/ui/clamp/clamp';
import { UiChip } from '../../../shared/ui/chip/chip';
import { UiGlyph } from '../../../shared/ui/glyph/glyph';
import { UiMeter } from '../../../shared/ui/meter/meter';
import { UiPriority } from '../../../shared/ui/priority/priority';
import { UiStageTrack } from '../../../shared/ui/stage-track/stage-track';
import { TYPE_GLYPHS, type TypeGlyphKind, UiTypeGlyph } from '../../../shared/ui/type-glyph/type-glyph';
import { UiWaitsChip } from '../../../shared/ui/waits-chip/waits-chip';
import type { Density } from '../../../core/settings.service';
import { LanguageService } from '../../../core/language.service';
import { formatDay } from '../../../shared/time/format';
import { UiTime } from '../../../shared/time/time';
import { stageIndex } from '../../spec/dashboard/dashboard-model';
import { PHASE_TONES, type SpecTableRow } from './spec-table-model';

/** i18n key for the agent dot's name; the English fallback stands until the key lands in both catalogues. */
const AGENT_KEY = 'specs.agentWorking';

/**
 * One spec as a row of the Specs panel, ported from the prototype's `spec-row` (styles.css 380-397, app.js specRow):
 * `type glyph + id | title + one-line description | agent dot + priority + mini five-segment stage track + phase chip |
 * meter + a/b` (spec 008: the type glyph before the number, `ui-priority` before the stage track, ISC-118). It
 * renders the cells only; the link and the roving tab stop are the list's (`spec-table`).
 *
 * Spec 025 (T24, ISC-163): the row is no longer wrapped in one `<a>`. The list projects its row link, the clamped
 * title stretched over the whole row, into the title line; a waiting spec's `ui-waits-chip` follows it there as its own
 * link to the blocker, lifted above the stretched link. The title cuts first, the chip never; the partial scope lives
 * only in the chip's accessible name (no `.meta` in the list).
 *
 * Forms (spec 021, design § P3 heights): the row reads the `specs` container the list declares. From 640 px it is one
 * 48 px line, `id | title · description | mark | agent | priority | mini track | phase | meter + a/b`; below 640 px two
 * lines, `id | title | a/b` over `mark · phase · priority` (without guidance `phase · priority · description`),
 * without meter bar and track.
 *
 * Density (spec 021, ISC-254): the list resolves it, the stored setting or the view's `?density=`. `compact` drops the
 * description and nothing else: at wide the title stands alone on its line, below 640 px line 2 is `mark · phase ·
 * priority`. The guidance reason stays the row link's description either way (R1).
 *
 * Spec 050 (T2, ISC-287): an archived row (`row().archived` present) keeps the grid, but its track cell holds only the
 * archive chip (icon `archive`, the word, a dashed border) where the phase chip stands, from 640 px behind the archive
 * date as `<time datetime>`; no priority, stage track, agent dot, waits chip, Next mark or ring. Its meter reads the
 * live claims. The list sets `archivedFirst` on the first archived row, whose top hairline is then dashed.
 *
 * Spec 052 (T17, ISC-300): a second slot takes the list's favorite star (`button[ui-star-toggle]`), a sibling of the
 * row link in its own cell above the link's stretch: from 640 px an end column of 32 px, below it line 2 under the
 * type glyph. The row only places it; the state and the click belong to the list. An archived row projects none.
 */
@Component({
  selector: 'app-spec-row',
  imports: [TranslocoPipe, UiChip, UiClamp, UiGlyph, UiMeter, UiPriority, UiStageTrack, UiTime, UiTypeGlyph, UiWaitsChip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './spec-row.html',
  styleUrl: './spec-row.css',
  host: {
    '[attr.data-density]': 'density()',
    '[attr.data-mark]': 'shownMark()',
    '[attr.data-archived]': "row().archived ? '' : null",
    '[attr.data-archived-first]': "archivedFirst() ? '' : null",
    '[attr.data-desc]': "description() ? '' : null",
    '[attr.data-overflow]': "overflowing() ? '' : null",
    '[attr.data-expanded]': "descriptionExpanded() ? '' : null",
  },
})
export class SpecRow {
  private readonly transloco = inject(TranslocoService);
  private readonly lang = toSignal(this.transloco.langChanges$, { initialValue: this.transloco.getActiveLang() });

  readonly row = input.required<SpecTableRow>();
  /** The five stage labels, translated once by the list. */
  readonly stageLabels = input.required<readonly string[]>();
  /** The resolved density (ISC-254): `compact` shows no description. */
  readonly density = input<Density>('comfortable');
  /** The description the row shows: the model's (ISC-249), none at `compact` density. */
  protected readonly description = computed(() => (this.density() === 'compact' ? null : this.row().description));
  /**
   * The row's guidance mark (spec 021, R1): `waits` shows the visible "Waits on you" chip, `next` the open ring, null
   * neither. The list derives it from the spec's own guidance entry; the entry's reason is the row link's description.
   */
  readonly mark = input<'waits' | 'next' | null>(null);
  /** Spec 050 (T2, ISC-287): the guidance mark the row shows; an archived row shows none. */
  protected readonly shownMark = computed(() => (this.row().archived ? null : this.mark()));
  /** Spec 050 (T2, ISC-287): the first archived row under the active ones; its top hairline is dashed. */
  readonly archivedFirst = input(false);
  /** Title and description show in full (the list's "more…" toggle, ISC-111). */
  readonly descriptionExpanded = input(false);
  /** Whether the title needs more than its line or the description more than its two, so the list offers "more…" outside the row link. */
  readonly descriptionOverflow = output<boolean>();

  /** The workspace slug the waits chip links in (T24). */
  readonly ws = input('');
  /** Blocker titles by `NNN` for the waits chip's accessible name (T24). */
  readonly titles = input<Readonly<Record<string, string>>>({});

  private readonly clamps = viewChildren(UiClamp);
  /** The title's clamp sits on the list's projected row link (T24). */
  private readonly titleClamps = contentChildren(UiClamp, { descendants: true });

  /** Title or description is cut; without a description the title line then keeps room for the list's "more…". */
  protected readonly overflowing = computed(() => [...this.titleClamps(), ...this.clamps()].some((clamp) => clamp.overflows()));

  constructor() {
    let last = false;
    effect(() => {
      const overflows = this.overflowing();
      if (overflows !== last) this.descriptionOverflow.emit((last = overflows));
    });
  }

  /** The row's `spec_type:` as a glyph kind; null for a missing or unknown type, which leaves the glyph slot empty. */
  protected readonly glyphType = computed<TypeGlyphKind | null>(() => {
    const type = this.row().type;
    return type !== null && Object.hasOwn(TYPE_GLYPHS, type) ? (type as TypeGlyphKind) : null;
  });
  protected readonly stageCurrent = computed(() => stageIndex(this.row().stage));
  /**
   * Stage `blocked` (spec 025, principal 2026-10-14): the track keeps the progress (blocked sits on Build) and marks the
   * current segment as the board's Blocked column, with the word "Blocked"; the phase chip stays as it is.
   */
  protected readonly stageBlocked = computed(() => this.row().stage === 'blocked');
  protected readonly stageAria = computed(() => {
    const labels = this.stageLabels();
    const index = Math.min(this.stageCurrent(), labels.length - 1);
    const stage = labels[index] ?? '';
    const word = this.stageBlocked() ? `${stage} · ${this.transloco.translate('stages.blocked')}` : stage;
    return this.transloco.translate('stages.position', { index: index + 1, total: labels.length, stage: word });
  });
  protected readonly phaseTone = computed(() => PHASE_TONES[this.row().phase ?? ''] ?? 'neutral');
  private readonly appLang = inject(LanguageService).current;
  /** Spec 050 (T2, ISC-287): the archive chip's title, "Archived on <day>"; null without an archive date. */
  protected readonly archivedTitle = computed(() => {
    const on = this.row().archived?.on ?? null;
    if (on === null) return null;
    const lang = this.appLang();
    return this.transloco.translate('specs.archivedOn', { date: formatDay(on, lang) });
  });
  protected readonly agentLabel = computed(() => {
    this.lang();
    const session = this.row().agent ?? '';
    return this.transloco.translate(AGENT_KEY, { session });
  });
}
