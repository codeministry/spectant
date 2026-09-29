import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { NotFound } from '../../layout/not-found/not-found';
import { ShellData } from '../../layout/shell/shell-data.service';
import { ShellState } from '../../layout/shell/shell-state.service';
import { TabBarSlot } from '../../layout/tab-bar/tab-bar-slot';
import { UiChip } from '../../shared/ui/chip/chip';

/**
 * `/w/:ws/s/:id`: the spec head (id, title, type and stage chips from the dashboard row until T52 serves the spec
 * route), the tab bar's main slot, then the tab's view. An unknown spec renders the not-found page (ISC-71).
 */
@Component({
  selector: 'app-spec-page',
  imports: [RouterOutlet, TranslocoPipe, NotFound, TabBarSlot, UiChip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { display: block; }
    .spec-head { display: grid; gap: 8px; margin-block-end: 16px; }
    h1 { display: flex; flex-wrap: wrap; gap: 4px 12px; align-items: baseline; margin: 0; font-family: var(--font-display); font-size: 24px; font-weight: 600; line-height: 32px; }
    .spec-id { color: var(--disp-ink); font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
    .spec-title { min-inline-size: 0; overflow-wrap: anywhere; }
    .chips { display: flex; flex-wrap: wrap; gap: 8px; }
    app-tab-bar-slot { margin-block-end: 24px; border-block-end: 1px solid var(--line); }
    app-tab-bar-slot:empty { display: none; }
    @container shell (width < 640px) { h1 { font-size: 20px; line-height: 28px; } }
  `,
  template: `
    @if (data.specMissing()) {
      <app-not-found />
    } @else {
      <section class="spec-head" aria-labelledby="spec-title">
        <h1 id="spec-title">
          <span class="spec-id">{{ state.specId() }}</span>
          @if (row(); as row) {
            <span class="spec-title">{{ row.title }}</span>
          }
        </h1>
        @if (row(); as row) {
          <div class="chips">
            @if (row.type) {
              <ui-chip>{{ row.type }}</ui-chip>
            }
            <ui-chip tone="primary" [dot]="true">{{ stageKey() | transloco }}</ui-chip>
          </div>
        }
      </section>
      <app-tab-bar-slot placement="main" />
      <router-outlet />
    }
  `,
})
export class SpecPage {
  protected readonly state = inject(ShellState);
  protected readonly data = inject(ShellData);
  protected readonly row = this.data.currentRow;
  protected readonly stageKey = computed(() => `stages.${this.row()?.stage ?? 'plan'}`);
}
