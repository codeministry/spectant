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
 * Settings, card Actors (T140, ISC-119.2; restyled by spec 024 T60): one row per
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
  styleUrl: './actors-section.css',
  templateUrl: './actors-section.html',
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
