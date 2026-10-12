import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import type { ActorRef } from '../../../../../../core/src/files';
import { UiIcon } from '../../icons/icon';
import { toneInk, toneMark, toneTint } from '../tone';

/** The chip's tone: the agent tone (`secondary`, the violet `--ques`), `warning` when stale, muted `legacy`. */
type ActorTone = 'neutral' | 'secondary' | 'warning' | 'legacy';

const COLORS: Record<ActorTone, { readonly tint: string; readonly ink: string; readonly mark: string }> = {
  neutral: { tint: toneTint('neutral'), ink: toneInk('neutral'), mark: toneMark('accent') },
  secondary: { tint: toneTint('secondary'), ink: toneInk('secondary'), mark: toneMark('accent') },
  warning: { tint: toneTint('warning'), ink: toneInk('warning'), mark: toneMark('warning') },
  legacy: { tint: toneTint('neutral'), ink: 'var(--muted-ink)', mark: toneMark('neutral') },
};

/**
 * Who holds or last moved a spec (ISC-131, design 008 § shared primitives): a person by the display name the caller
 * resolved from the actors resource, or the raw `u:` id in mono when unmapped; a legacy value muted with its raw string
 * and the word "legacy"; an agent or sub-agent with the `bot` glyph in the agent tone, its session id in mono and, for
 * a sub-agent, its task. `active` adds the lime lock dot, `stale` the warning tone and the "no release" label (which
 * wins over `active`). No avatars, no initials. Every state is said in words, never by colour or a tooltip alone.
 */
@Component({
  selector: 'ui-actor-chip',
  imports: [TranslocoPipe, UiIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[attr.data-kind]': 'actor().kind',
    '[attr.data-tone]': 'tone()',
    '[attr.data-active]': "isActive() ? '' : null",
    '[attr.data-stale]': "stale() ? '' : null",
    '[attr.title]': 'actor().raw',
    '[style.--actor-tint]': 'colors().tint',
    '[style.--actor-ink]': 'colors().ink',
    '[style.--actor-mark]': 'colors().mark',
  },
  styles: `
    :host { display: inline-flex; gap: 6px; align-items: center; min-inline-size: 0; max-inline-size: 100%; block-size: 24px; padding-inline: 8px; border-radius: 999px; background: var(--actor-tint); color: var(--actor-ink); font-size: 12px; font-variant-numeric: tabular-nums; font-weight: 600; line-height: 16px; white-space: nowrap; }
    .label { min-inline-size: 0; overflow: hidden; text-overflow: ellipsis; }
    .mono, .task { font-family: var(--font-mono); font-weight: 500; }
    .suffix, .stale { font-weight: 500; }
    .dot { flex: none; inline-size: 6px; block-size: 6px; border-radius: 50%; background: var(--actor-mark); }
    .vh { position: absolute; inline-size: 1px; block-size: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
    @media (forced-colors: active) {
      :host { border: 1px solid CanvasText; }
      .dot { background: CanvasText; }
    }
  `,
  template: `
    @if (agent()) {
      <ui-icon name="bot" [size]="14" />
      <span class="vh">{{ 'actors.agent' | transloco }}</span>
    }
    <span class="label" [class.mono]="mono()">{{ text() }}</span>
    @if (actor().task; as task) {
      <span class="task">{{ task }}</span>
    }
    @if (actor().legacy) {
      <span class="suffix">{{ 'actors.legacy' | transloco }}</span>
    }
    @if (isActive() || stale()) {
      <span class="dot" aria-hidden="true"></span>
    }
    @if (isActive()) {
      <span class="vh">{{ 'actors.active' | transloco }}</span>
    }
    @if (stale()) {
      <span class="stale">
        @if (staleAge(); as age) {
          {{ 'actors.staleFor' | transloco: { age } }}
        } @else {
          {{ 'actors.stale' | transloco }}
        }
      </span>
    }
  `,
})
export class UiActorChip {
  readonly actor = input.required<ActorRef>();
  /** The display name the caller mapped from the actors resource; absent or null shows the raw id. */
  readonly name = input<string | null>();
  /** An agent's lock is held right now. */
  readonly active = input(false);
  /** The lock is past the stale age without a release. */
  readonly stale = input(false);
  /** How long past, already formatted by the caller ("47 min"); shown after the stale label. */
  readonly staleAge = input<string>();

  protected readonly agent = computed(() => this.actor().kind === 'agent' || this.actor().kind === 'subagent');
  protected readonly isActive = computed(() => this.active() && !this.stale());
  protected readonly text = computed(() => (this.actor().legacy ? this.actor().raw : (this.name() ?? this.actor().id)));
  /** Ids and raw values are mono; a mapped person's name is text. */
  protected readonly mono = computed(() => !this.name() || this.actor().legacy);

  protected readonly tone = computed<ActorTone>(() => {
    if (this.actor().legacy) return 'legacy';
    if (this.stale()) return 'warning';
    return this.agent() ? 'secondary' : 'neutral';
  });
  protected readonly colors = computed(() => COLORS[this.tone()]);
}
