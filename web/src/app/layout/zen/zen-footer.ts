import { ChangeDetectionStrategy, Component, computed, inject, ViewEncapsulation } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { UiIcon } from '../../shared/icons/icon';
import { UiChip } from '../../shared/ui/chip/chip';
import { UiCommandChip } from '../../shared/ui/command-chip/command-chip';
import { UiMeter } from '../../shared/ui/meter/meter';
import { UiWsBadge } from '../../shared/ui/ws-badge/ws-badge';
import { notesLinkOf } from '../spec-head/notes-link';
import { RailContent } from '../shell/rail-content';
import { ShellData } from '../shell/shell-data.service';
import { ShellState } from '../shell/shell-state.service';

/**
 * Zen's footer status bar (ISC-75, T38; design.md § Zen per tier): a sticky 40 px bar at the bottom of the shell that
 * takes the spec head's place while zen is on. Spec 024 sets it as the `zen-statusbar`: 36 px, 12 px muted
 * text on the page glass, the path `← <ws badge> ws / area` back to the workspace, the id and the 600 title, then pushed
 * right the type chip (plain) and the stage chip, followed by the app's claims meter (`25/30`), the command chip with
 * copy and the notes pill (ISC-75); compact: path · id · chips · claims · command chip.
 *
 * The values come from the spec payload (`head`, `keyNumbers.claims`, `areas.notes`), the dashboard row until it
 * answers. Unencapsulated on purpose: the one rule that hides the spec head reaches into `app-spec-page`, which this
 * lane does not own; every other selector is prefixed with the host element, so nothing leaks.
 */
@Component({
  selector: 'app-zen-footer',
  imports: [NgTemplateOutlet, RouterLink, TranslocoPipe, UiChip, UiCommandChip, UiIcon, UiMeter, UiWsBadge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  styleUrl: './zen-footer.css',
  templateUrl: './zen-footer.html',
})
export class ZenFooter {
  private readonly state = inject(ShellState);
  private readonly data = inject(ShellData);
  /** A view's bottom bar (the board's frame bar, T88), rendered inside this bar so zen shows one bar, not two. */
  protected readonly bar = inject(RailContent).bar;

  private readonly body = computed(() => {
    const spec = this.data.spec.value();
    return spec?.kind === 'ok' ? spec.body : null;
  });

  protected readonly id = computed(() => this.body()?.head.id ?? this.state.specId());
  protected readonly title = computed(() => this.body()?.head.title ?? this.data.currentRow()?.title ?? null);
  protected readonly type = computed(() => this.body()?.head.type ?? null);
  /** The path: back to the workspace, its name, then the open area. */
  protected readonly wsPath = computed(() => {
    const ws = this.state.ws();
    return ws === null ? null : { link: '/w/' + ws, name: this.data.workspaceName(ws) };
  });
  protected readonly areaKey = computed(() => `shell.areas.${this.state.area() ?? 'status'}`);
  protected readonly stageKey = computed(() => `stages.${this.body()?.head.stage ?? this.data.currentRow()?.stage ?? 'plan'}`);
  protected readonly claims = computed(() => {
    const claims = this.body()?.keyNumbers.claims;
    return claims ? { closed: claims.closed, total: claims.total } : null;
  });
  protected readonly command = computed(() => this.body()?.head.nextCommand ?? null);
  protected readonly notes = computed(() => this.body()?.areas.notes.count ?? null);
  protected readonly notesLink = computed(() => notesLinkOf(this.state.ws(), this.state.specId()));
}
