import { booleanAttribute, ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import type { ItemStateInfo, SpecWait } from '../../../../../../core/src/files';
import { LanguageService } from '../../../core/language.service';
import { UiTime } from '../../time';
import { UiActorChip } from '../actor-chip/actor-chip';
import { UiChip } from '../chip/chip';
import { UiCommandChip } from '../command-chip/command-chip';
import { UiGlyph } from '../glyph/glyph';
import { UiStateChip } from '../state-chip/state-chip';
import { UiWaitsChip } from '../waits-chip/waits-chip';
import { elapsedText } from './duration';

/** Marks the text before and after a placeholder, so a translated phrase can wrap an element (`started <time>`). */
const SPLIT = '\u0000';

/**
 * Spec 040 (T46, ISC-224, ISC-225.1): the state line of an item, on every surface in one order: glyph · "‹Stage› ·
 * ‹state›" · details. It renders the API's `ItemStateInfo` as it is and computes no state (ISC-221.1):
 *
 * - `open`: the command as a copyable `ui-command-chip`; the reason only in the accessible text, visible in `block`.
 * - `waiting`: the specs it waits on as `ui-waits-chip` links (claims as their ids), never a command.
 * - `running`: "· since 3 min" from `run.elapsedMs`, the command chip locked by the run, the agent's actor chip and the
 *   finer state as a detail. No timer and no `aria-live`: the refresh tick brings the next `elapsedMs`.
 * - `aborted`: the state word as the warning chip on `--hover-t`, "started ‹time›", the actor chip stale, the command
 *   copyable again (an aborted run does not lock).
 * - `done`: the date, and "dropped" / "struck" for a claim or task closed without being done; in the `done` stage the
 *   stage word alone.
 *
 * A chip "2 runs" stands behind the line when more than one run is open. A diagnostic is the quiet note in place of
 * the missing detail, never an invented value. Content marked `uiItemStateAction` is projected beside a run's details
 * (the release button of T62). `block` is the status block's form: details one per row, nothing hidden, and a running
 * run's start beside its duration (T49). `details` is the task row's form (T54): the details alone, the duration among
 * them, without the head and the finer state, which the row's status cell already shows.
 */
@Component({
  selector: 'ui-item-state',
  imports: [TranslocoPipe, UiActorChip, UiChip, UiCommandChip, UiGlyph, UiStateChip, UiTime, UiWaitsChip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[attr.data-state]': 'info().state',
    '[attr.data-kind]': 'info().kind',
    '[attr.data-block]': "block() ? '' : null",
    '[attr.data-details]': "details() ? '' : null",
  },
  styles: `
    :host { display: flex; flex-wrap: wrap; gap: 4px 8px; align-items: center; min-inline-size: 0; font-size: 13px; line-height: 20px; }
    :host([data-block]) { flex-direction: column; align-items: flex-start; gap: 8px; font-size: 15px; line-height: 24px; }
    .head, .details { display: inline-flex; flex-wrap: wrap; gap: 4px 8px; align-items: center; min-inline-size: 0; }
    :host([data-block]) .details { flex-direction: column; align-items: flex-start; }
    .line { min-inline-size: 0; font-weight: 600; }
    .num { font-variant-numeric: tabular-nums; font-weight: 500; }
    .muted { color: var(--muted-ink); }
    .mono { font-family: var(--font-mono); font-size: 12px; }
    .vh { position: absolute; inline-size: 1px; block-size: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  `,
  template: `
    @if (!details()) {
    <span class="head">
      <ui-glyph [state]="info().state" family="item" [size]="14" />
      <span class="line" data-item-line>
        @if (stateShown()) {
          {{ lineParts()[0] }}
          @if (info().state === 'aborted') {
            <ui-state-chip state="aborted" family="item" small />
          } @else {
            {{ 'states.item.' + info().state | transloco }}
          }
          {{ lineParts()[1] }}
        } @else {
          {{ stageWord() }}
        }
        @if (since(); as since) {
          <span class="num">{{ since }}</span>
        }
      </span>
      @if (runs(); as runs) {
        <ui-chip variant="count" data-runs>{{ runs }}</ui-chip>
      }
    </span>
    }
    <span class="details">
      @let run = info().run;
      @switch (info().state) {
        @case ('open') {
          @if (info().command; as command) {
            <ui-command-chip [command]="command" />
          }
          @if (info().reason; as reason) {
            <span class="muted" data-phrase [class.vh]="!block()">{{ reason }}</span>
          }
        }
        @case ('waiting') {
          @if (waitsChip(); as wait) {
            <ui-waits-chip [wait]="wait" [ws]="ws()" />
          }
          @if (waitsText(); as items) {
            <span class="muted mono" data-waits-text>{{ 'itemState.waitsOn' | transloco: { items } }}</span>
          }
        }
        @case ('running') {
          @if (run) {
            @if (run.command; as command) {
              <ui-command-chip [command]="command" [lockedBy]="run" />
            }
            @if (!noActor()) {
              <ui-actor-chip [actor]="run.actor" [active]="true" />
            }
            @if (details() && duration(); as duration) {
              <span class="muted num" data-since>{{ 'itemState.since' | transloco: { duration } }}</span>
            }
            @if (block()) {
              <span class="muted" data-started>{{ started()[0] }}<ui-time [value]="run.since" />{{ started()[1] }}</span>
            }
          }
          @if (!details() && info().detail; as detail) {
            <span class="muted" data-detail>{{ detail }}</span>
          }
          <ng-content select="[uiItemStateAction]" />
        }
        @case ('aborted') {
          @if (run) {
            <span class="muted" data-started>{{ started()[0] }}<ui-time [value]="run.since" />{{ started()[1] }}</span>
            @if (!noActor()) {
              <ui-actor-chip [actor]="run.actor" [stale]="true" [staleAge]="duration() ?? undefined" />
            }
            @if (run.command; as command) {
              <ui-command-chip [command]="command" />
            }
          }
          <ng-content select="[uiItemStateAction]" />
        }
        @case ('done') {
          @if (info().doneAt; as doneAt) {
            <span class="muted num" data-done><ui-time [value]="doneAt" [form]="doneAt.length === 10 ? 'day' : 'date'" /></span>
          }
          @if (info().closedAs; as closedAs) {
            <span class="muted" data-closed-as>{{ 'itemState.closedAs.' + closedAs | transloco }}</span>
          }
        }
      }
      @if (info().diagnostic; as diagnostic) {
        <span class="muted" data-diagnostic>{{ diagnostic.message }}</span>
      }
    </span>
  `,
})
export class UiItemState {
  /** The item's state with its details, as the API delivers it. */
  readonly info = input.required<ItemStateInfo>();
  /** The stage word from the caller (a board column's label); without it the stage key's word from `stages.*`. */
  readonly stageLabel = input<string>();
  /** The workspace slug, for the links of `waiting`; without it the specs it waits on read as plain ids. */
  readonly ws = input('');
  /** The status block's form: larger, every detail on its own row, the reason visible. */
  readonly block = input(false, { transform: booleanAttribute });
  /** The task row's form: the details alone, the duration among them (the row's status cell names the state). */
  readonly details = input(false, { transform: booleanAttribute });
  /** Leave the run's actor chip out: the caller already shows who holds the item (a task row's agent and sub-agent). */
  readonly noActor = input(false, { transform: booleanAttribute });

  private readonly transloco = inject(TranslocoService);
  private readonly lang = inject(LanguageService).current;

  private t(key: string, params: Record<string, unknown> = {}): string {
    return this.transloco.translate(key, params, this.lang());
  }

  protected readonly stageWord = computed(() => {
    const label = this.stageLabel();
    if (label) return label;
    const stage = this.info().stage;
    if (!stage) return null;
    const key = `stages.${stage}`;
    const word = this.t(key);
    return word === key ? stage : word;
  });

  /** In the `done` stage the stage word already says done; without a stage the state word stands alone. */
  protected readonly stateShown = computed(() => !(this.info().state === 'done' && this.info().stage === 'done') || !this.stageWord());

  /** "Tasks · " and "" around the state word (`itemState.line`), in the active language's order. */
  protected readonly lineParts = computed(() => {
    const stage = this.stageWord();
    if (!stage) return ['', ''] as const;
    const [before = '', after = ''] = this.t('itemState.line', { stage, state: SPLIT }).split(SPLIT);
    return [before, after] as const;
  });

  protected readonly duration = computed(() => {
    const run = this.info().run;
    if (!run) return null;
    const { key, params } = elapsedText(run.elapsedMs);
    return this.t(key, params);
  });

  protected readonly since = computed(() => {
    const duration = this.duration();
    return this.info().state === 'running' && duration !== null ? ` · ${this.t('itemState.since', { duration })}` : null;
  });

  protected readonly runs = computed(() => {
    const count = this.info().run?.openRuns ?? 0;
    return count > 1 ? this.t('itemState.runs.other', { count }) : null;
  });

  /** "started " and "" around the time element, in the active language's order. */
  protected readonly started = computed(() => {
    const [before = '', after = ''] = this.t('itemState.started', { time: SPLIT }).split(SPLIT);
    return [before, after] as const;
  });

  private readonly waitSpecs = computed(() => {
    const waits = this.info().waits;
    return waits ? [...waits.specs, ...waits.siblings] : [];
  });

  protected readonly waitsChip = computed<SpecWait | null>(() => {
    const blockers = this.waitSpecs();
    if (!this.ws() || blockers.length === 0) return null;
    const { id, spec } = this.info();
    return { spec: spec ?? id, blockers, heldTasks: 0, openTasks: 0, full: true };
  });

  protected readonly waitsText = computed(() => {
    const claims = this.info().waits?.claims ?? [];
    const ids = this.ws() ? claims : [...this.waitSpecs(), ...claims];
    return ids.length === 0 ? null : ids.join(', ');
  });
}
