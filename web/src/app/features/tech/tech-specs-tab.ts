import { ChangeDetectionStrategy, Component, computed, inject, input, signal, ViewEncapsulation } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import type { TechModel, TechSpec } from '../../../../../core/src/files';
import { specLink } from '../../layout/shell/areas';
import { ShellData, type SpecRowView } from '../../layout/shell/shell-data.service';
import { ShellState } from '../../layout/shell/shell-state.service';
import { UiIcon } from '../../shared/icons/icon';
import { UiCard } from '../../shared/ui/card/card';
import { UiDocProse } from '../../shared/ui/doc-prose/doc-prose';
import { UiTypeGlyph } from '../../shared/ui/type-glyph/type-glyph';

/** One card of the Specs tab: the tech model's spec (its `title` is the dashboard row's) and whether it is complete. */
export interface TechSpecCard {
  readonly spec: TechSpec;
  readonly complete: boolean;
}

/** The cards in the order the Status tab also uses: the open specs, then the complete ones behind a divider. */
export interface TechSpecGroups {
  readonly open: readonly TechSpecCard[];
  readonly complete: readonly TechSpecCard[];
}

/**
 * The tech model's specs in the dashboard's row order (design.md § Inhalt und Modell): `rows` is `ShellData.specRows`,
 * the order the dashboard shows and `[` / `]` walk. A spec the dashboard has no row for follows in number order; a
 * spec whose `phase:` is `complete` goes to the second group, in the same order.
 */
export function techSpecGroups(specs: readonly TechSpec[], rows: readonly SpecRowView[]): TechSpecGroups {
  const rank = new Map(rows.map((row, index) => [row.id, index]));
  // "Complete" as the Status tab and the SPECS tile count it: the dashboard row's stage `done`; a spec without a row
  // falls back to its phase.
  const stages = new Map(rows.map((row) => [row.id, row.stage]));
  const position = (spec: TechSpec): number => rank.get(spec.id) ?? rows.length;
  const cards = [...specs]
    .sort((a, b) => position(a) - position(b) || a.id.localeCompare(b.id))
    .map((spec): TechSpecCard => {
      const stage = stages.get(spec.id);
      return { spec, complete: stage === undefined ? spec.phase === 'complete' : stage === 'done' };
    });
  return { open: cards.filter((card) => !card.complete), complete: cards.filter((card) => card.complete) };
}

/**
 * The Specs tab of the tech page (spec 023, T17, ISC-134.1; design.md § Specs, § Verweise auf die Dokumente): one
 * `ui-card` per spec, the open specs in the dashboard's order, then the divider `Complete · n` and the complete specs,
 * muted through ink, never opacity. A card holds its head (mono id, type glyph, title), the `## Goal` of spec.md and,
 * only when the spec has a plan.md, the first paragraph of its `## Approach` (both core-rendered `DocsPage`s, shown
 * through `ui-doc-prose`), and a footer link `Open spec`.
 *
 * Every excerpt links to the document it comes from: the Goal heading to the spec page (`Goal of 018`), the Approach
 * heading to Docs › Plan (`Plan of 018`), as real `routerLink`s, 44 px tall at compact. The headings carry the links,
 * so no control sits inside the prose and the prose's own links never nest in another one. Below wide each excerpt is
 * clipped to four lines with a "More…" / "Less" toggle, as on the dashboard brief; wide shows them whole.
 *
 * Not encapsulated: the clip reaches into `ui-doc-prose`'s article; every selector starts with `app-tech-specs-tab`.
 */
@Component({
  selector: 'app-tech-specs-tab',
  imports: [RouterLink, TranslocoPipe, UiCard, UiDocProse, UiIcon, UiTypeGlyph],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  host: { 'data-tech-tab': 'specs', '[attr.data-tier]': 'tier()' },
  styleUrl: './tech-specs-tab.css',
  templateUrl: './tech-specs-tab.html',
})
export class TechSpecsTab {
  private readonly state = inject(ShellState);
  private readonly data = inject(ShellData);

  readonly model = input.required<TechModel>();

  protected readonly tier = computed(() => this.state.tier());
  protected readonly wide = computed(() => this.tier() === 'wide');
  protected readonly ws = computed(() => this.state.ws() ?? '');
  protected readonly groups = computed(() => techSpecGroups(this.model().specs, this.data.specRows()));
  /** Open specs first, then the complete ones; the divider stands before the first complete card. */
  protected readonly cards = computed(() => [...this.groups().open, ...this.groups().complete]);
  protected readonly link = specLink;

  /** The excerpts expanded below wide, keyed `<id>-goal` / `<id>-approach`. */
  private readonly expanded = signal<ReadonlySet<string>>(new Set());

  protected isExpanded(key: string): boolean {
    return this.expanded().has(key);
  }

  protected clipped(key: string): boolean {
    return !this.wide() && !this.isExpanded(key);
  }

  protected toggle(key: string): void {
    this.expanded.update((keys) => {
      const next = new Set(keys);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }
}
