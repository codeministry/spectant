import { ChangeDetectionStrategy, Component, computed, inject, linkedSignal, resource, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { parseActor } from '../../../../../core/src/actor';
import type { ActorRef } from '../../../../../core/src/files';
import { ApiClient } from '../../core/api.service';
import { ShellData } from '../../layout/shell/shell-data.service';
import { UiActorChip } from '../../shared/ui/actor-chip/actor-chip';
import { UiButton } from '../../shared/ui/button/button';
import { UiCard } from '../../shared/ui/card/card';
import { type ActorDraft, actorRows, type ActorRow, mappingsOf, personIdsIn } from './actors-model';

type SaveState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'saving' }
  | { readonly kind: 'saved' }
  | { readonly kind: 'failed'; readonly status: number };

type Field = 'displayName' | 'gitIdentities';

/**
 * Settings, section Actors (T140, ISC-119.2): one row per known person id, the stored mappings (`GET /api/actors`)
 * together with every `u:` id the registered workspaces' dashboard and planning trees name (assignees, lock holders).
 * Each row has its chip as the app shows it today, an editable display name and the git identities as one
 * comma-separated input. Save sends the whole list through `ShellData.saveActors`, as the API replaces it; a row with a
 * blank name stays unmapped, and an id outside the person grammar is never sent. The server reports no viewer id to
 * the client yet, so no row is pre-filled for the viewer.
 */
@Component({
  selector: 'app-actors-section',
  imports: [TranslocoPipe, UiActorChip, UiButton, UiCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-section': 'actors' },
  styles: `
    :host { display: block; margin-block-start: 24px; }
    h2 { margin: 0 0 8px; font-size: 16px; font-weight: 600; line-height: 24px; }
    .intro, .hint, .empty, .status { margin: 0; color: var(--muted-ink); font-size: 14px; line-height: 20px; }
    .rows { display: grid; gap: 16px; margin: 16px 0 0; padding: 0; list-style: none; }
    .row { display: grid; grid-template-columns: minmax(0, 1fr); gap: 8px; min-inline-size: 0; }
    .field { display: grid; gap: 4px; min-inline-size: 0; font-size: 12px; font-weight: 600; line-height: 16px; }
    .field input { inline-size: 100%; }
    .git { font-family: var(--font-mono); }
    .hint { margin-block-start: 8px; font-size: 12px; line-height: 16px; }
    .actions { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; margin-block-start: 16px; }
    @container shell (inline-size >= 640px) {
      .row { grid-template-columns: 200px minmax(0, 1fr) minmax(0, 1fr); align-items: end; }
    }
  `,
  template: `
    <ui-card [padding]="24">
      <h2 id="actors-heading">{{ 'settings.actors.title' | transloco }}</h2>
      <p class="intro">{{ 'settings.actors.intro' | transloco }}</p>
      @if (rows().length === 0) {
        <p class="empty" data-actors-empty>{{ 'settings.actors.empty' | transloco }}</p>
      } @else {
        <ul class="rows" aria-labelledby="actors-heading">
          @for (row of rows(); track row.id) {
            <li class="row" [attr.data-actor-row]="row.id">
              <span><ui-actor-chip [actor]="actorOf(row.id)" [name]="storedName(row.id)" /></span>
              <label class="field">
                {{ 'settings.actors.displayName' | transloco }}
                <input
                  class="input input-sm"
                  type="text"
                  autocomplete="off"
                  data-actor-name
                  [value]="row.displayName"
                  [attr.aria-label]="'settings.actors.nameFor' | transloco: { id: row.id }"
                  (input)="edit(row.id, 'displayName', $event)"
                />
              </label>
              <label class="field">
                {{ 'settings.actors.gitIdentities' | transloco }}
                <input
                  class="input input-sm git"
                  type="text"
                  autocomplete="off"
                  spellcheck="false"
                  data-actor-git
                  aria-describedby="actors-git-hint"
                  [value]="row.gitIdentities"
                  [attr.aria-label]="'settings.actors.gitFor' | transloco: { id: row.id }"
                  (input)="edit(row.id, 'gitIdentities', $event)"
                />
              </label>
            </li>
          }
        </ul>
        <p class="hint" id="actors-git-hint">{{ 'settings.actors.gitHint' | transloco }}</p>
        <div class="actions">
          <button ui-button type="button" data-actors-save [disabled]="state().kind === 'saving'" (click)="save()">
            {{ 'settings.actors.save' | transloco }}
          </button>
          <p class="status" role="status" data-actors-status [attr.data-state]="state().kind">
            @switch (state().kind) {
              @case ('saving') { {{ 'settings.actors.saving' | transloco }} }
              @case ('saved') { {{ 'settings.actors.saved' | transloco }} }
              @case ('failed') { {{ 'settings.actors.failed' | transloco: { status: failedStatus() } }} }
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

  protected edit(id: string, field: Field, event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.edits.update((edits) => new Map(edits).set(id, { ...edits.get(id), [field]: value }));
    if (this.state().kind !== 'saving') this.state.set({ kind: 'idle' });
  }

  /** `PUT /api/actors` with the whole list as the rows stand. */
  protected async save(): Promise<void> {
    this.state.set({ kind: 'saving' });
    const result = await this.data.saveActors(mappingsOf(this.rows()));
    this.state.set(result.kind === 'ok' ? { kind: 'saved' } : { kind: 'failed', status: result.status });
  }
}
