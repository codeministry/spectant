import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import type { Frame, FrameCard, LiveFrame } from '../../../../../../../core/src/files';
import { UiIcon } from '../../../../shared/icons/icon';
import { UiGlyph } from '../../../../shared/ui/glyph/glyph';
import { glyphSpec } from '../../../../shared/ui/glyph/states';
import { UiStateChip } from '../../../../shared/ui/state-chip/state-chip';
import { toneMark } from '../../../../shared/ui/tone';
import { staleAgents } from '../live-frame';
import { AgentChip } from './agent-chip';
import { RAIL_BLOCK_STYLES } from './rail-block.styles';

/** Placeholder values the stale-agent sentence is translated with, so its session and claim ids can be put back as parts. */
const SESSION = '\u0001session\u0001';
const CLAIMS = '\u0001claims\u0001';
export const ALERT_PLACEHOLDERS = { session: SESSION, claims: CLAIMS } as const;

/**
 * A run of the stale-agent sentence: plain text, or an id (the session or a claim) that must not break across lines,
 * with the punctuation that follows it (`tail`, e.g. "," or ":") kept on its line.
 */
export interface AlertPart {
  readonly kind: 'text' | 'id';
  readonly text: string;
  readonly tail: string;
}

/** Moves the punctuation that opens a text part onto the id before it, so no line starts with "," or ":". */
function glue(parts: readonly AlertPart[]): AlertPart[] {
  const out: AlertPart[] = [];
  for (const part of parts) {
    const last = out.at(-1);
    const tail = part.kind === 'text' && last?.kind === 'id' ? (/^\p{P}+/u.exec(part.text)?.[0] ?? '') : '';
    if (last !== undefined && tail !== '') {
      out[out.length - 1] = { ...last, tail: last.tail + tail };
      if (part.text.length > tail.length) out.push({ ...part, text: part.text.slice(tail.length) });
    } else {
      out.push(part);
    }
  }
  return out;
}

/**
 * Splits the translated stale-agent sentence at its two placeholders. The session and every claim id become `id`
 * parts carrying the punctuation that follows them; the words between the claims come from the app language's
 * `Intl.ListFormat`, so neither the sentence's word order nor the list joiner lives in the template.
 */
export function alertParts(sentence: string, session: string, claims: readonly string[], joiner: Intl.ListFormat): AlertPart[] {
  const list = joiner
    .formatToParts(claims)
    .map((p): AlertPart => ({ kind: p.type === 'element' ? 'id' : 'text', text: p.value, tail: '' }));
  const text = (value: string): AlertPart[] => (value === '' ? [] : [{ kind: 'text', text: value, tail: '' }]);
  return glue(
    sentence.split(SESSION).flatMap((chunk, i): AlertPart[] => [
      ...(i > 0 ? [{ kind: 'id' as const, text: session, tail: '' }] : []),
      ...chunk.split(CLAIMS).flatMap((piece, j) => [...(j > 0 ? list : []), ...text(piece)]),
    ]),
  );
}

/**
 * "Needs you" (T88, ISC-87; design.md § Live, Rail): the stale-agent alert first (a session the model marked stale may
 * have died, T85), then the frame's list as the model gives it (`needsYouOf`: question, concerns, open operator steps),
 * each row with a 4 px edge in its state's colour. The count is the list's length, never recomputed. The rail block at
 * wide and the second tab of the bottom bar's sheet below wide (`framed` false: the segment names it there).
 */
@Component({
  selector: 'app-needs-you',
  imports: [AgentChip, NgTemplateOutlet, TranslocoPipe, UiGlyph, UiIcon, UiStateChip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-needs-you': '' },
  styles: [
    RAIL_BLOCK_STYLES,
    `
      .count { font-variant-numeric: tabular-nums; }
      .edge { border-inline-start: 4px solid var(--edge); border-start-start-radius: 0; border-end-start-radius: 0; }
      .alert { display: flex; gap: 8px; align-items: start; padding: 8px 12px; border: 1px solid var(--line); border-inline-start: 4px solid var(--fail-ink); border-radius: var(--radius-field); background: var(--color-base-200); font-size: 13px; line-height: var(--rail-line); }
      .alert ui-icon { flex: none; margin-block-start: 2px; color: var(--fail-ink); }
      .alert-body { display: grid; gap: 4px; min-inline-size: 0; }
      .alert p { margin: 0; overflow-wrap: anywhere; }
      .alert .id-run { display: inline-block; max-inline-size: 100%; overflow-wrap: anywhere; }
      .alert .id { font-family: var(--font-mono); }
      @media (forced-colors: active) { .edge, .alert { border-inline-start-color: CanvasText; } }
    `,
  ],
  template: `
    @if (framed()) {
      <section class="block" aria-labelledby="needs-you-heading">
        <h3 class="head" id="needs-you-heading">
          {{ 'board.rail.needsYou' | transloco }}
          <span class="badge badge-sm count" data-needs-count>{{ cards().length }}</span>
        </h3>
        <ng-container [ngTemplateOutlet]="body" />
      </section>
    } @else {
      <ng-container [ngTemplateOutlet]="body" />
    }

    <ng-template #body>
      @for (alert of alerts(); track alert.agent.session) {
        @let agent = alert.agent;
        <div class="alert" data-stale-agent [attr.data-session]="agent.session">
          <ui-icon name="triangle-alert" [size]="16" />
          <div class="alert-body">
            <p>
              @for (part of alert.parts; track $index) {
                @if (part.kind === 'id') {
                  <span class="id-run"><span class="id" data-alert-id>{{ part.text }}</span>{{ part.tail }}</span>
                } @else {
                  <span>{{ part.text }}</span>
                }
              }
            </p>
            <app-agent-chip [session]="agent.session" [since]="agent.since" [stale]="true" />
          </div>
        </div>
      }
      @if (cards().length > 0) {
        <ul class="rows">
          @for (c of cards(); track c.task) {
            <li>
              <button type="button" class="row edge" [attr.data-needs-card]="c.task" [style.--edge]="edge(c)" (click)="opened.emit(c)">
                <ui-glyph [state]="c.state" family="card" [size]="14" />
                <span class="mono">{{ c.task }}</span>
                <span class="text">{{ c.text }}</span>
                <ui-state-chip [state]="c.state" family="card" />
              </button>
            </li>
          }
        </ul>
      } @else {
        <p class="empty">{{ 'board.rail.emptyNeeds' | transloco }}</p>
      }
    </ng-template>
  `,
})
export class NeedsYou {
  readonly frame = input.required<Frame | LiveFrame>();
  /** The frame's Needs you list (`needsYouOf`), in the model's order. */
  readonly cards = input.required<readonly FrameCard[]>();
  readonly framed = input(true);
  readonly opened = output<FrameCard>();

  protected readonly stale = computed(() => staleAgents(this.frame()));

  private readonly transloco = inject(TranslocoService);
  // Read by the computed that translates, so a language switch or the catalogue's arrival re-renders the alert.
  private readonly translation = toSignal(this.transloco.selectTranslation());
  /** The sentence and its list joiner for the active language: rebuilt on a language change only, never per frame. */
  private readonly copy = computed(() => {
    if (this.translation() === undefined) return null;
    const lang = this.transloco.getActiveLang();
    return { sentence: this.transloco.translate('board.agent.staleAlert', ALERT_PLACEHOLDERS, lang), joiner: new Intl.ListFormat(lang, { type: 'conjunction' }) };
  });
  /** Each stale agent with its sentence in parts; none until the catalogue is there, so no alert renders without words. */
  protected readonly alerts = computed(() => {
    const copy = this.copy();
    if (copy === null) return [];
    return this.stale().map((agent) => ({ agent, parts: alertParts(copy.sentence, agent.session, agent.claims, copy.joiner) }));
  });

  protected edge(card: FrameCard): string {
    return toneMark(glyphSpec(card.state, 'card').tone);
  }
}
