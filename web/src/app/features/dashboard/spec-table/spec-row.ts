import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { UiAgentDot } from '../../../shared/ui/agent-dot/agent-dot';
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
import { stageIndex } from '../../../core/model/stage-track';
import { toneOfStage } from '../../../shared/ui/stage-tone';
import type { SpecTableRow } from './spec-table-model';

/** i18n key for the agent dot's name; the English fallback stands until the key lands in both catalogues. */
const AGENT_KEY = 'specs.agentWorking';

/** Spec 068 (T1, ISC-546): the row grid's two forms, the spec list's and Next up's (with the `command` column). */
export type RowVariant = 'list' | 'next';

/**
 * One spec as a row of the Specs panel (`spec-row`, T89):
 * `type glyph + id | title | agent dot + priority + mini five-segment stage track + phase chip | meter + a/b` (spec 008: the type glyph before the number, `ui-priority` before the stage track, ISC-118). It
 * renders the cells only; the link and the roving tab stop are the list's (`spec-table`).
 *
 * Spec 025 (T24, ISC-163): the row is no longer wrapped in one `<a>`. The list projects its row link, the title
 * stretched over the whole row, into the title line; a waiting spec's `ui-waits-chip` follows it there as its own
 * link to the blocker, lifted above the stretched link. The title cuts first, the chip never; the partial scope lives
 * only in the chip's accessible name (no `.meta` in the list).
 *
 * Forms (spec 021, design § P3 heights): the row reads the `specs` container the list declares. Since spec 064 (T45,
 * ISC-487) every cell names its fixed column of `_row-grid.css` with `data-cell` and renders even when empty: from
 * 640 px one 48 px line, `id | title | feature | mark | agent | prio | track | phase | meter | star`; below 640 px two
 * lines, `id title star` over `· mark prio phase meter`, without agent dot, meter bar and track. The title stands
 * alone, one line cut by an ellipsis like an idea row's: no goal line under or behind it and no "…" toggle (the
 * former `more` column, T46, ISC-489, is gone); the full title is the row link's tooltip.
 *
 * Density (spec 021, ISC-254): the list resolves it, the stored setting or the view's `?density=`, and the row
 * carries it as `data-density`. Since the row shows no description, both densities render the same row. The guidance
 * reason stays the row link's description either way (R1).
 *
 * Spec 050 (T2, ISC-287): an archived row (`row().archived` present) keeps the grid, but its track cell holds only the
 * archive chip (icon `archive`, the word, a dashed border) where the phase chip stands, from 640 px behind the archive
 * date as `<time datetime>`; no priority, stage track, agent dot, waits chip, Next mark or ring. Its meter reads the
 * live claims. The list sets `archivedFirst` on the first archived row, whose top hairline is then dashed.
 *
 * Spec 052 (T17, ISC-300): a second slot takes the list's favorite star (`button[ui-star-toggle]`), a sibling of the
 * row link in its own cell above the link's stretch: from 640 px an end column of 32 px, below it line 2 under the
 * type glyph. The row only places it; the state and the click belong to the list. An archived row projects none.
 *
 * Spec 068 (T1, ISC-546): the variant `next`, set only by Next up, adds a last cell `command` (`data-variant="next"`,
 * the grid's extra column in `_row-grid.css`) that takes Next up's copy chip (`[cell-command]`); the list's rows
 * (variant `list`) render no such cell and keep their grid.
 */
@Component({
  selector: 'app-spec-row',
  imports: [TranslocoPipe, UiAgentDot, UiChip, UiGlyph, UiMeter, UiPriority, UiStageTrack, UiTime, UiTypeGlyph, UiWaitsChip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './spec-row.html',
  styleUrl: './spec-row.css',
  host: {
    '[attr.data-density]': 'density()',
    '[attr.data-mark]': 'shownMark()',
    '[attr.data-archived]': "row().archived ? '' : null",
    '[attr.data-archived-first]': "archivedFirst() ? '' : null",
    '[attr.data-variant]': "variant() === 'next' ? 'next' : null",
  },
})
export class SpecRow {
  /** Spec 068 (T1, ISC-546): `next` adds the `command` cell for Next up's copy chip; the list keeps `list`. */
  readonly variant = input<RowVariant>('list');
  private readonly transloco = inject(TranslocoService);
  private readonly lang = toSignal(this.transloco.langChanges$, { initialValue: this.transloco.getActiveLang() });

  readonly row = input.required<SpecTableRow>();
  /** The five stage labels, translated once by the list. */
  readonly stageLabels = input.required<readonly string[]>();
  /** The resolved density (ISC-254), carried as `data-density`; the row looks the same at both. */
  readonly density = input<Density>('comfortable');
  /**
   * The row's guidance mark (spec 021, R1): `waits` shows the visible "Waits on you" chip, `next` the open ring, null
   * neither. The list derives it from the spec's own guidance entry; the entry's reason is the row link's description.
   */
  readonly mark = input<'waits' | 'next' | null>(null);
  /** Spec 050 (T2, ISC-287): the guidance mark the row shows; an archived row shows none. */
  protected readonly shownMark = computed(() => (this.row().archived ? null : this.mark()));
  /** Spec 050 (T2, ISC-287): the first archived row under the active ones; its top hairline is dashed. */
  readonly archivedFirst = input(false);

  /** The workspace slug the waits chip links in (T24). */
  readonly ws = input('');
  /** Blocker titles by `NNN` for the waits chip's accessible name (T24). */
  readonly titles = input<Readonly<Record<string, string>>>({});

  /** The row's `spec_type:` as a glyph kind; null for a missing or unknown type, which leaves the glyph slot empty. */
  protected readonly glyphType = computed<TypeGlyphKind | null>(() => {
    const type = this.row().type;
    return type !== null && Object.hasOwn(TYPE_GLYPHS, type) ? (type as TypeGlyphKind) : null;
  });
  protected readonly stageCurrent = computed(() => stageIndex(this.row().stage));
  /**
   * Stage `blocked` (spec 025, principal 2026-10-14): the track keeps the progress (blocked sits on Build) and marks the
   * current segment as the board's Blocked column, with the word "Blocked"; the status chip names it too (ISC-500).
   */
  protected readonly stageBlocked = computed(() => this.row().stage === 'blocked');
  protected readonly stageAria = computed(() => {
    const labels = this.stageLabels();
    const index = Math.min(this.stageCurrent(), labels.length - 1);
    const stage = labels[index] ?? '';
    const word = this.stageBlocked() ? `${stage} · ${this.transloco.translate('stages.blocked')}` : stage;
    return this.transloco.translate('stages.position', { index: index + 1, total: labels.length, stage: word });
  });
  /** Spec 064 (T59, ISC-500): the status chip's tone, the row's stage's (`stage-tone.ts`). */
  protected readonly stageTone = computed(() => toneOfStage(this.row().stage));
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
