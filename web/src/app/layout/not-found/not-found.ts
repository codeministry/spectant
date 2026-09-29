import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { UiButton } from '../../shared/ui/button/button';
import { UiCard } from '../../shared/ui/card/card';
import { ShellData } from '../shell/shell-data.service';
import { ShellState } from '../shell/shell-state.service';

/**
 * The not-found page (ISC-71): an unknown path, workspace, spec or tab. No fallback and no redirect; the way back is
 * the workspace when it exists, else all workspaces.
 */
@Component({
  selector: 'app-not-found',
  imports: [RouterLink, TranslocoPipe, UiButton, UiCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-page': 'not-found' },
  styles: `
    :host { display: block; max-inline-size: 640px; }
    h1 { margin: 0 0 8px; font-family: var(--font-display); font-size: 24px; font-weight: 600; line-height: 32px; }
    p { margin: 0 0 24px; color: var(--muted-ink); font-size: 14px; line-height: 20px; }
  `,
  template: `
    <ui-card [padding]="24">
      <h1>{{ 'notFound.title' | transloco }}</h1>
      <p>{{ 'notFound.body' | transloco }}</p>
      @if (workspace(); as workspace) {
        <a ui-button [routerLink]="['/w', workspace.slug]">{{
          'notFound.backWorkspace' | transloco: { workspace: workspace.name }
        }}</a>
      } @else {
        <a ui-button routerLink="/">{{ 'notFound.back' | transloco }}</a>
      }
    </ui-card>
  `,
})
export class NotFound {
  private readonly state = inject(ShellState);
  private readonly data = inject(ShellData);

  protected readonly workspace = computed(() => {
    const ws = this.state.ws();
    if (ws === null || this.data.dashboard.value()?.kind !== 'ok') return null;
    return { slug: ws, name: this.data.workspaceName(ws) };
  });
}
