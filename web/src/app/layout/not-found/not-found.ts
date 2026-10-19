import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { filter } from 'rxjs';
import { KeyboardService } from '../../core/keyboard.service';
import { UiIcon } from '../../shared/icons/icon';
import { UiButton } from '../../shared/ui/button/button';
import { UiCard } from '../../shared/ui/card/card';
import { UiChip } from '../../shared/ui/chip/chip';
import { UiKbd } from '../../shared/ui/kbd/kbd';
import { UiPageHead } from '../../shared/ui/page-head/page-head';
import { ShellData, type SpecRowView } from '../shell/shell-data.service';
import { ShellState } from '../shell/shell-state.service';

/** The `count` spec rows whose numeric id lies nearest to `id`, in id order; none when `id` is not a number. */
export function nearestSpecs(rows: readonly SpecRowView[], id: string, count = 3): SpecRowView[] {
  const target = Number.parseInt(id, 10);
  if (!Number.isFinite(target)) return [];
  const distance = (row: SpecRowView): number => Math.abs(Number.parseInt(row.id, 10) - target);
  const numbered = rows.filter((row) => Number.isFinite(Number.parseInt(row.id, 10)));
  const near = [...numbered].sort((a, b) => distance(a) - distance(b) || a.id.localeCompare(b.id)).slice(0, count);
  return near.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * The not-found page (ISC-71; spec 024 T65, design.md § NotFound and the static prototype `not-found.html`): an
 * unknown path, workspace, spec or tab. No fallback and no redirect. The page head `SPECTANT · 404`, then one card:
 * the empty state (`compass` in its circle, "Nothing at this address", the path, why) with All workspaces, Search
 * (the palette) and, in a known workspace, the way back to it. A spec id the known workspace does not list is the
 * variant "Spec 099 is not in <ws>": the way back to the workspace dashboard first, then the three nearest spec ids.
 */
@Component({
  selector: 'app-not-found',
  imports: [RouterLink, TranslocoPipe, UiButton, UiCard, UiChip, UiIcon, UiKbd, UiPageHead],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-page': 'not-found' },
  styles: `
    :host { display: block; }
    h1 { margin: 0; }
    .nf-wrap { display: grid; gap: var(--space-4); inline-size: 100%; max-inline-size: 560px; margin: var(--space-4) auto 0; }
    @container shell (inline-size >= 1120px) { .nf-wrap { margin-block-start: var(--space-6); } }
    .empty { display: grid; gap: 8px; justify-items: center; padding: var(--space-6) var(--space-4); text-align: center; }
    .nf-glyph { display: grid; place-items: center; inline-size: 48px; block-size: 48px; margin-block-end: 8px; border-radius: 50%; background: var(--color-base-300); color: var(--muted); }
    h2 { margin: 0; font-family: var(--font-brand); font-size: 20px; font-weight: 600; line-height: 28px; }
    p { margin: 0; color: var(--muted); font-size: 14px; line-height: 20px; text-wrap: pretty; }
    .path { display: inline-flex; align-items: center; padding: 0 8px; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--lane); color: var(--color-base-content); font-family: var(--font-mono); font-size: 13px; line-height: 22px; overflow-wrap: anywhere; }
    .mono { font-family: var(--font-mono); }
    .nf-actions { display: flex; flex-wrap: wrap; gap: var(--space-2); align-items: center; justify-content: center; margin-block-start: 8px; }
    .nf-actions ui-kbd { margin-inline-start: 4px; }
    .text-link { display: inline-flex; gap: 4px; align-items: center; color: var(--disp-text); font-size: 13px; text-decoration: none; }
    .text-link:hover { text-decoration: underline; }
    .c-head { display: flex; flex-wrap: wrap; gap: 4px 12px; align-items: center; justify-content: space-between; padding: 12px var(--space-3); border-block-end: 1px solid var(--line); }
    .c-head h2 { font-size: 15px; line-height: 24px; }
    .card-pad { display: grid; gap: 8px; padding: var(--space-3); }
    .dense-list { display: grid; margin: 0; padding: 0; list-style: none; }
    .d-row { display: grid; grid-template-columns: 40px minmax(0, 1fr) auto; gap: 12px; align-items: center; min-block-size: 44px; padding: 0 var(--space-3); border-block-start: 1px solid var(--line); color: var(--color-base-content); font-size: 14px; text-decoration: none; }
    .d-row:hover { background: var(--lane); }
    .d-row .id { color: var(--disp-text); font-family: var(--font-mono); font-size: 13px; font-weight: 500; }
    .d-row .t { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .set-foot { display: flex; flex-wrap: wrap; gap: var(--space-2); align-items: center; padding: 12px var(--space-3); border-block-start: 1px solid var(--line); }
  `,
  template: `
    <ui-page-head [segments]="[('shell.eyebrow.app' | transloco), ('notFound.eyebrow' | transloco)]">
      <h1 class="type-page-title">{{ 'notFound.title' | transloco }}</h1>
    </ui-page-head>
    <div class="nf-wrap">
      @if (missingSpec(); as missing) {
        <section data-nf-variant="spec">
          <ui-card [padding]="0">
            <div class="c-head">
              <h2>{{ 'notFound.specTitle' | transloco: { id: missing.id, workspace: missing.name } }}</h2>
              <a class="text-link" [routerLink]="['/w', missing.slug]" data-nf-back
                ><ui-icon name="arrow-left" [size]="14" />{{ 'notFound.dashboard' | transloco: { workspace: missing.name } }}</a
              >
            </div>
            <div class="card-pad">
              <p>{{ 'notFound.noPage' | transloco }} <span class="path">{{ path() }}</span></p>
              @if (missing.nearest.length > 0) {
                <p>{{ 'notFound.nearest' | transloco: { workspace: missing.name } }}</p>
              }
            </div>
            @if (missing.nearest.length > 0) {
              <ul class="dense-list">
                @for (row of missing.nearest; track row.id) {
                  <li>
                    <a class="d-row" [routerLink]="['/w', missing.slug, 's', row.id]" [attr.data-nf-spec]="row.id">
                      <span class="id">{{ row.id }}</span>
                      <span class="t">{{ row.title }}</span>
                      <ui-chip variant="small">{{ row.stage }}</ui-chip>
                    </a>
                  </li>
                }
              </ul>
            }
            <div class="set-foot">
              <a ui-button variant="primary" routerLink="/"><ui-icon name="layers" [size]="14" />{{ 'notFound.back' | transloco }}</a>
              <button ui-button type="button" data-action="search" (click)="keyboard.openPalette()">
                <ui-icon name="search" [size]="14" />{{ 'notFound.search' | transloco }}<ui-kbd>⌘K</ui-kbd>
              </button>
            </div>
          </ui-card>
        </section>
      } @else {
        <section>
          <ui-card [padding]="0">
            <div class="empty">
              <span class="nf-glyph"><ui-icon name="compass" [size]="24" /></span>
              <h2>{{ 'notFound.nothing' | transloco }}</h2>
              <p>{{ 'notFound.noPage' | transloco }} <span class="path">{{ path() }}</span></p>
              @if (state.ws() === null) {
                <p>{{ 'notFound.routeWhy' | transloco }} <span class="mono">/w/&lt;workspace&gt;/s/&lt;id&gt;</span></p>
              } @else {
                <p>{{ 'notFound.body' | transloco }}</p>
              }
              <div class="nf-actions">
                <a ui-button variant="primary" routerLink="/"><ui-icon name="layers" [size]="14" />{{ 'notFound.back' | transloco }}</a>
                <button ui-button type="button" data-action="search" (click)="keyboard.openPalette()">
                  <ui-icon name="search" [size]="14" />{{ 'notFound.search' | transloco }}<ui-kbd>⌘K</ui-kbd>
                </button>
                @if (workspace(); as workspace) {
                  <a class="text-link" [routerLink]="['/w', workspace.slug]">{{
                    'notFound.backWorkspace' | transloco: { workspace: workspace.name }
                  }}</a>
                }
              </div>
            </div>
          </ui-card>
        </section>
      }
    </div>
  `,
})
export class NotFound {
  protected readonly state = inject(ShellState);
  private readonly data = inject(ShellData);
  protected readonly keyboard = inject(KeyboardService);

  /** The requested path, without query or fragment, as the router last settled on it. */
  protected readonly path = signal('');

  constructor() {
    const router = inject(Router);
    const strip = (url: string): string => url.split(/[?#]/u)[0] ?? url;
    this.path.set(strip(router.url));
    router.events
      .pipe(
        filter((event) => event instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe((event) => this.path.set(strip(event.urlAfterRedirects)));
  }

  /** The open workspace when it exists (its dashboard answered). */
  protected readonly workspace = computed(() => {
    const ws = this.state.ws();
    if (ws === null || this.data.dashboard.value()?.kind !== 'ok') return null;
    return { slug: ws, name: this.data.workspaceName(ws) };
  });

  /** The variant: a spec id the known workspace does not list, with the nearest ids it does list. */
  protected readonly missingSpec = computed(() => {
    const workspace = this.workspace();
    const id = this.state.specId();
    if (workspace === null || id === null || !this.data.specMissing()) return null;
    return { ...workspace, id, nearest: nearestSpecs(this.data.specRows(), id) };
  });
}
