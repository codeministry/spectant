import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { NotFound } from '../../layout/not-found/not-found';
import { ShellData } from '../../layout/shell/shell-data.service';
import { ShellState } from '../../layout/shell/shell-state.service';
import { UiChip } from '../../shared/ui/chip/chip';

/** `/w/:ws` until T39 moves spec 001's dashboard into the shell: the spec rows as links (id, title, stage), minimal. */
@Component({
  selector: 'app-workspace-page',
  imports: [RouterLink, TranslocoPipe, NotFound, UiChip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-page': 'workspace' },
  styles: `
    :host { display: block; }
    h1 { margin: 0 0 16px; font-family: var(--font-display); font-size: 24px; font-weight: 600; line-height: 32px; }
    ul { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
    a { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 12px; align-items: center; min-block-size: 44px; padding: 8px 16px; border: 1px solid var(--line); border-radius: var(--radius-box); background: var(--color-base-100); color: var(--color-base-content); text-decoration: none; }
    .id { color: var(--disp-ink); font-family: var(--font-mono); font-size: 12px; font-variant-numeric: tabular-nums; }
    .title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    p { color: var(--muted-ink); }
  `,
  template: `
    @if (data.workspaceMissing()) {
      <app-not-found />
    } @else if (data.workspaceUnavailable()) {
      <p>{{ 'shell.unavailable' | transloco }}</p>
    } @else {
      <h1>{{ 'shell.placeholder.workspaceSpecs' | transloco: { workspace: name() } }}</h1>
      <ul>
        @for (row of data.specRows(); track row.id) {
          <li>
            <a [routerLink]="['/w', state.ws(), 's', row.id]">
              <span class="id">{{ row.id }}</span>
              <span class="title">{{ row.title }}</span>
              <ui-chip tone="primary">{{ 'stages.' + row.stage | transloco }}</ui-chip>
            </a>
          </li>
        }
      </ul>
    }
  `,
})
export class WorkspacePage {
  protected readonly state = inject(ShellState);
  protected readonly data = inject(ShellData);
  protected readonly name = computed(() => this.data.workspaceName(this.state.ws() ?? ''));
}
