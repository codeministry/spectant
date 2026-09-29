import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { ShellData } from '../../layout/shell/shell-data.service';
import { UiChip } from '../../shared/ui/chip/chip';

/** `/` until T39 moves spec 001's overview into the shell: the registered workspaces as links, minimal. */
@Component({
  selector: 'app-overview-page',
  imports: [RouterLink, TranslocoPipe, UiChip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-page': 'overview' },
  styles: `
    :host { display: block; }
    h1 { margin: 0 0 16px; font-family: var(--font-display); font-size: 24px; font-weight: 600; line-height: 32px; }
    ul { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
    a { display: flex; gap: 8px; align-items: center; min-block-size: 44px; padding-inline: 16px; border: 1px solid var(--line); border-radius: var(--radius-box); background: var(--color-base-100); color: var(--color-base-content); text-decoration: none; }
    p { color: var(--muted-ink); }
  `,
  template: `
    <h1>{{ 'overview.title' | transloco }}</h1>
    @if (list(); as list) {
      @if (list.length > 0) {
        <ul>
          @for (workspace of list; track workspace.slug) {
            <li>
              <a [routerLink]="['/w', workspace.slug]">
                <span>{{ workspace.name }}</span>
                @if (!workspace.readable) {
                  <ui-chip tone="warning">{{ 'overview.unreadable' | transloco }}</ui-chip>
                }
              </a>
            </li>
          }
        </ul>
      } @else {
        <p>{{ 'overview.empty.title' | transloco }}</p>
      }
    } @else if (failed()) {
      <p>{{ 'shell.error' | transloco }}</p>
    } @else {
      <p>{{ 'common.loading' | transloco }}</p>
    }
  `,
})
export class OverviewPage {
  private readonly data = inject(ShellData);
  protected readonly list = computed(() => {
    const result = this.data.workspaces.value();
    return result?.kind === 'ok' ? result.body : null;
  });
  protected readonly failed = computed(() => {
    const result = this.data.workspaces.value();
    return result !== undefined && result.kind !== 'ok';
  });
}
