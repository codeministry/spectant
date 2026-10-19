import { ChangeDetectionStrategy, Component, computed, inject, linkedSignal, resource, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { parseActor } from '../../../../../core/src/actor';
import type { ActorRef } from '../../../../../core/src/files';
import { ApiClient } from '../../core/api.service';
import { ShellData } from '../../layout/shell/shell-data.service';
import { UiIcon } from '../../shared/icons/icon';
import { UiActorChip } from '../../shared/ui/actor-chip/actor-chip';
import { UiButton } from '../../shared/ui/button/button';
import { UiCard } from '../../shared/ui/card/card';
import { UiNotice } from '../../shared/ui/notice/notice';
import { UiSkeleton } from '../../shared/ui/skeleton/skeleton';
import { type ActorDraft, actorRows, type ActorRow, mappingsOf, personIdsIn } from './actors-model';

type SaveState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'saving' }
  | { readonly kind: 'saved' }
  | { readonly kind: 'conflict' }
  | { readonly kind: 'failed'; readonly status: number };

type Field = 'displayName' | 'gitIdentities';

/**
 * Settings, card Actors (T140, ISC-119.2; restyled by spec 024 T60 after the prototype's `settings.html`): one row per
 * known person id, the stored mappings (`GET /api/actors`) together with every `u:` id the registered workspaces'
 * dashboard and planning trees name (assignees, lock holders). Each row has its chip as the app shows it today, an
 * editable display name and the git identities as one comma-separated input. Save sends the whole list through
 * `ShellData.saveActors`, as the API replaces it; a row with a blank name stays unmapped (with git identities typed,
 * the name field says it is required), and an id outside the person grammar is never sent. States: skeleton rows
 * while loading, a disabled "Saving…" button, the saved mark, a red notice on a failed save and a warning notice with
 * Reload on a 409. The server reports no viewer id to the client yet, so no row is pre-filled for the viewer.
 */
@Component({
  selector: 'app-actors-section',
  imports: [TranslocoPipe, UiActorChip, UiButton, UiCard, UiIcon, UiNotice, UiSkeleton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-section': 'actors', role: 'region', 'aria-labelledby': 'actors-heading' },
  styles: `
    :host { display: block; container-type: inline-size; }
    .c-head { display: flex; flex-wrap: wrap; gap: 4px 12px; align-items: baseline; justify-content: space-between; padding: 12px var(--space-3); border-block-end: 1px solid var(--line); }
    h2 { margin: 0; font-family: var(--font-brand); font-size: 15px; font-weight: 600; line-height: 24px; }
    .card-pad { padding: var(--space-3); }
    .meta, .intro, .empty { margin: 0; color: var(--muted); font-size: 13px; line-height: 20px; }
    .eyebrow { color: var(--muted); font-size: 11px; font-weight: 600; letter-spacing: 0.06em; line-height: 16px; text-transform: uppercase; }
    .actor-head, .actor-row { display: grid; gap: var(--space-2); }
    .actor-head { display: none; margin-block-start: 12px; }
    .rows { margin: 0; padding: 0; list-style: none; }
    .actor-row { padding: 12px 0; border-block-start: 1px solid var(--line); }
    .actor-row > span:first-child { justify-self: start; }
    label { display: grid; min-inline-size: 0; }
    .field { box-sizing: border-box; inline-size: 100%; min-inline-size: 0; block-size: 36px; padding: 0 10px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--lane); color: var(--color-base-content); font: inherit; font-size: 14px; }
    .field:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
    .field.mono { font-family: var(--font-mono); font-size: 13px; }
    @media (pointer: coarse) { .field { block-size: 44px; } }
    .field-help { margin-block-start: 4px; color: var(--muted); font-size: 12px; line-height: 16px; }
    .field-err { display: flex; gap: 6px; align-items: center; margin-block-start: 4px; color: var(--hover-text); font-size: 12px; line-height: 16px; }
    .glyph-ok { color: var(--clos-text); }
    .sr-only { position: absolute; inline-size: 1px; block-size: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
    .set-foot { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; padding: 12px var(--space-3); border-block-start: 1px solid var(--line); }
    .actors-status { display: inline-flex; gap: 6px; align-items: center; margin: 0; color: var(--muted); font-size: 12px; line-height: 16px; }
    .actors-status[data-state='saved'] { color: var(--done-text); }
    ui-notice { margin: 0 var(--space-3) var(--space-3); }
    .n-title { display: block; font-weight: 600; }
    .skel-row { display: grid; grid-template-columns: 40px 1fr 64px; gap: 12px; align-items: center; block-size: 48px; border-block-start: 1px solid var(--line); }
    @container (inline-size >= 640px) {
      .actor-head { display: grid; grid-template-columns: 160px minmax(0, 1fr) minmax(0, 1fr) 32px; gap: 12px; }
      .actor-row { grid-template-columns: 160px minmax(0, 1fr) minmax(0, 1fr) 32px; gap: 12px; align-items: start; }
      .actor-row > span:first-child { margin-block-start: 8px; }
      .glyph-ok { margin-block-start: 10px; }
    }
  `,
  template: `
    <ui-card [padding]="0">
      <div class="c-head">
        <h2 id="actors-heading">{{ 'settings.actors.title' | transloco }}</h2>
        <span class="meta">{{ 'settings.actorsTable.found' | transloco: { count: rows().length } }}</span>
      </div>
      <div class="card-pad">
        <p class="intro">{{ 'settings.actors.intro' | transloco }}</p>
        @if (loading()) {
          <div data-actors-loading aria-busy="true">
            @for (i of skeletons; track i) {
              <div class="skel-row"><ui-skeleton height="12px" /><ui-skeleton height="12px" /><ui-skeleton height="12px" /></div>
            }
          </div>
        } @else if (rows().length === 0) {
          <p class="empty" data-actors-empty>{{ 'settings.actors.empty' | transloco }}</p>
        } @else {
          <div class="actor-head" aria-hidden="true">
            <span class="eyebrow">{{ 'settings.actorsTable.personId' | transloco }}</span>
            <span class="eyebrow">{{ 'settings.actors.displayName' | transloco }}</span>
            <span class="eyebrow">{{ 'settings.actors.gitIdentities' | transloco }}</span>
            <span></span>
          </div>
          <ul class="rows" aria-labelledby="actors-heading">
            @for (row of rows(); track row.id) {
              <li class="actor-row" [attr.data-actor-row]="row.id">
                <span><ui-actor-chip [actor]="actorOf(row.id)" [name]="storedName(row.id)" /></span>
                <label>
                  <input
                    class="field"
                    type="text"
                    autocomplete="off"
                    data-actor-name
                    [value]="row.displayName"
                    [attr.placeholder]="'settings.actors.displayName' | transloco"
                    [attr.aria-label]="'settings.actors.nameFor' | transloco: { id: row.id }"
                    [attr.aria-invalid]="nameMissing(row) ? 'true' : null"
                    (input)="edit(row.id, 'displayName', $event)"
                  />
                  @if (nameMissing(row)) {
                    <span class="field-err" data-actor-error
                      ><ui-icon name="triangle-alert" [size]="12" />{{ 'settings.actorsTable.nameRequired' | transloco }}</span
                    >
                  }
                </label>
                <label>
                  <input
                    class="field mono"
                    type="text"
                    autocomplete="off"
                    spellcheck="false"
                    data-actor-git
                    aria-describedby="actors-git-hint"
                    [value]="row.gitIdentities"
                    [attr.aria-label]="'settings.actors.gitFor' | transloco: { id: row.id }"
                    (input)="edit(row.id, 'gitIdentities', $event)"
                  />
                  <span class="field-help" aria-hidden="true">{{ 'settings.actors.gitHint' | transloco }}</span>
                </label>
                @if (row.displayName.trim() !== '') {
                  <span class="glyph-ok" [attr.title]="'settings.actorsTable.valid' | transloco"><ui-icon name="check" [size]="16" /></span>
                } @else {
                  <span></span>
                }
              </li>
            }
          </ul>
          <span class="sr-only" id="actors-git-hint">{{ 'settings.actors.gitHint' | transloco }}</span>
        }
      </div>
      @if (state().kind === 'failed') {
        <ui-notice tone="error" data-actors-error>
          <span class="n-title">{{ 'settings.states.failedTitle' | transloco }}</span>
          <span class="meta">{{ 'settings.actors.failed' | transloco: { status: failedStatus() } }}</span>
        </ui-notice>
      } @else if (state().kind === 'conflict') {
        <ui-notice tone="warning" data-actors-conflict>
          <span class="n-title">{{ 'settings.states.conflictTitle' | transloco }}</span>
          <span class="meta">{{ 'settings.states.conflictBody' | transloco }}</span>
          <button ui-button action type="button" size="sm" data-actors-reload (click)="reload()">
            <ui-icon name="refresh-cw" [size]="14" />{{ 'settings.states.reload' | transloco }}
          </button>
        </ui-notice>
      }
      @if (!loading() && rows().length > 0) {
        <div class="set-foot">
          <button ui-button variant="primary" type="button" data-actors-save [disabled]="state().kind === 'saving'" (click)="save()">
            <ui-icon [name]="state().kind === 'saving' ? 'loader-circle' : 'check'" [size]="14" />
            {{ (state().kind === 'saving' ? 'settings.actors.saving' : 'settings.actors.save') | transloco }}
          </button>
          <p class="actors-status" role="status" data-actors-status [attr.data-state]="state().kind">
            @if (state().kind === 'saved') {
              <ui-icon name="check" [size]="14" />{{ 'settings.actors.saved' | transloco }}
            }
          </p>
        </div>
      }
    </ui-card>
  `,
})
export class ActorsSection {
  private readonly api = inject(ApiClient);
  private readonly data = inject(ShellData);

  protected readonly skeletons = [0, 1, 2];

  /** The person ids every readable registered workspace names in its dashboard and planning tree. */
  private readonly seen = resource({
    params: () => ({ slugs: this.data.workspaceList().filter((w) => w.readable).map((w) => w.slug) }),
    loader: async ({ params }) => {
      const ids = new Set<string>();
      const answers = await Promise.all(params.slugs.flatMap((ws) => [this.api.dashboard(ws), this.api.planning(ws)]));
      for (const answer of answers) if (answer.kind === 'ok') personIdsIn(answer.body, ids);
      return ids;
    },
  });
  private readonly seenIds = computed<ReadonlySet<string>>(() => (this.seen.hasValue() ? this.seen.value() : new Set()));

  /** Skeleton rows until the stored mappings and the first scan of the workspaces have answered. */
  protected readonly loading = computed(
    () => (this.data.actors.isLoading() && !this.data.actors.hasValue()) || (this.seen.isLoading() && !this.seen.hasValue()),
  );

  /** The edits since the stored list last changed; a reload after a save drops them. */
  private readonly edits = linkedSignal<unknown, ReadonlyMap<string, Partial<ActorDraft>>>({
    source: () => this.data.actorList(),
    computation: () => new Map(),
  });
  private readonly base = computed<readonly ActorRow[]>(() => actorRows(this.data.actorList(), this.seenIds()));
  protected readonly rows = computed<readonly ActorRow[]>(() => {
    const edits = this.edits();
    return this.base().map((row) => ({ ...row, ...edits.get(row.id) }));
  });
  private readonly names = computed(() => new Map(this.data.actorList().map((m) => [m.id, m.displayName])));

  protected readonly state = signal<SaveState>({ kind: 'idle' });
  protected readonly failedStatus = computed(() => {
    const state = this.state();
    return state.kind === 'failed' ? state.status : 0;
  });

  protected actorOf(id: string): ActorRef {
    return parseActor(id);
  }

  /** The stored name the chip shows; null (the raw id) for an id without a mapping. */
  protected storedName(id: string): string | null {
    return this.names().get(id) ?? null;
  }

  /** Git identities without a name: the row would stay unmapped, so the name field says it is required. */
  protected nameMissing(row: ActorRow): boolean {
    return row.displayName.trim() === '' && row.gitIdentities.trim() !== '';
  }

  protected edit(id: string, field: Field, event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.edits.update((edits) => new Map(edits).set(id, { ...edits.get(id), [field]: value }));
    if (this.state().kind !== 'saving') this.state.set({ kind: 'idle' });
  }

  /** The 409's way out: read the stored list again (the edits drop with it). */
  protected reload(): void {
    this.state.set({ kind: 'idle' });
    this.data.actors.reload();
  }

  /** `PUT /api/actors` with the whole list as the rows stand. */
  protected async save(): Promise<void> {
    this.state.set({ kind: 'saving' });
    const result = await this.data.saveActors(mappingsOf(this.rows()));
    if (result.kind === 'ok') this.state.set({ kind: 'saved' });
    else this.state.set(result.status === 409 ? { kind: 'conflict' } : { kind: 'failed', status: result.status });
  }
}
