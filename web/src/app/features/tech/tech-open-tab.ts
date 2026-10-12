import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import type { DocsPage, SpecType, TechModel } from '../../../../../core/src/files';
import { specLink } from '../../layout/shell/areas';
import { ShellState } from '../../layout/shell/shell-state.service';
import { UiCard } from '../../shared/ui/card/card';
import { UiDocProse } from '../../shared/ui/doc-prose/doc-prose';
import { UiTypeGlyph } from '../../shared/ui/type-glyph/type-glyph';

/** One spec of the Open tab: its fog lines under the mono id, type glyph and title. */
interface FogGroup {
  readonly id: string;
  readonly type: SpecType | null;
  readonly title: string;
  readonly lines: readonly string[];
  /** `/w/:ws/s/:id/status`, where the spec's open questions stand (design.md § Verweise auf die Dokumente). */
  readonly link: string[];
}

/**
 * The Open tab of the tech page (spec 023, T18, ISC-134.1; design.md § Open): first the `risks` page of
 * `specs/tech.md` through `ui-doc-prose` without its table of contents (the heading comes from the file), in a
 * `ui-card` at medium and wide and straight on the page at compact; then the count line and one card holding a group
 * per spec not yet complete that has `- fog:` lines. Every fog line is a link to the spec's status tab, named
 * `Status of <id>`. The title is `TechSpec.title`, the one core gives the spec's dashboard row.
 *
 * Without `specs/tech.md` (`model.pages` null) the muted line `[data-tech-norisks]` (`tech.open.noRisks`, T23,
 * ISC-134.2) holds the risks' place, without a command chip: the Overview and Architecture empty states carry it.
 */
@Component({
  selector: 'app-tech-open-tab',
  imports: [RouterLink, TranslocoPipe, UiCard, UiDocProse, UiTypeGlyph],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './tech-open-tab.css',
  templateUrl: './tech-open-tab.html',
})
export class TechOpenTab {
  private readonly state = inject(ShellState);

  readonly model = input.required<TechModel>();

  protected readonly compact = computed(() => this.state.tier() === 'compact');

  /** The risks page without its contents list: the design shows the prose only. */
  protected readonly risks = computed<DocsPage | null>(() => {
    const risks = this.model().pages?.risks;
    return risks === undefined ? null : { ...risks, toc: [] };
  });

  protected readonly groups = computed<readonly FogGroup[]>(() => {
    const ws = this.state.ws() ?? '';
    return this.model()
      .specs.filter((spec) => spec.phase !== 'complete' && spec.fog.length > 0)
      .map((spec) => ({
        id: spec.id,
        type: spec.type,
        title: spec.title,
        lines: spec.fog,
        link: specLink(ws, spec.id, 'status'),
      }));
  });

  protected readonly lines = computed(() => this.groups().reduce((sum, group) => sum + group.lines.length, 0));
}
