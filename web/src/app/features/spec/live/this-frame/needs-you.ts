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
import { agentKey, staleAgents } from '../live-frame';
import { AgentChip } from './agent-chip';
import { RAIL_BLOCK_STYLES } from './rail-block.styles';

/** Placeholder values the stale-agent sentence is translated with, so its session and claim ids can be put back as parts. */
const SESSION = '\u0001session\u0001';
const CLAIMS = '\u0001claims\u0001';
export const ALERT_PLACEHOLDERS = { session: SESSION, claims: CLAIMS } as const;

/** A piece of a run: an id (the session or a claim), or the characters that touch it without a space between. */
export interface RunPiece {
  readonly id: boolean;
  readonly text: string;
}

/**
 * A part of the stale-agent sentence: plain text, or a run, the whitespace-delimited token that holds one id or more
 * together with whatever touches them ("(ISC-74),", "„spec-1“", "spec-1/ISC-2"), rendered as one unit that breaks only
 * where the sentence has a space.
 */
export type AlertPart = { readonly kind: 'text'; readonly text: string } | { readonly kind: 'run'; readonly pieces: readonly RunPiece[] };

/**
 * Where a line may break between words (UAX #14): the spaces it breaks after (SP; the BA spaces U+1680, U+2000 to
 * U+2006, U+2008 to U+200A, U+205F, U+3000; ZW U+200B) and the mandatory breaks (BK, CR, LF, NL: U+000A to U+000D,
 * U+0085, U+2028, U+2029). A no-break space (U+00A0, U+2007, U+202F) is absent, so it stays inside a token as in layout.
 */
export const BREAKABLE = '[ \\t\\n\\v\\f\\r\\u0085\\u1680\\u2000-\\u2006\\u2008-\\u200A\\u2028\\u2029\\u205F\\u3000\\u200B]';
const BREAK = new RegExp(`(${BREAKABLE}+)`);

/**
 * Splits the translated stale-agent sentence at its two placeholders and groups it into tokens at breakable white space:
 * a token that holds an id becomes a run, every other stretch stays text. The alert therefore breaks like ordinary
 * text and never inside an id's token, whatever classes a language gives its brackets, quotes and apostrophes, and
 * ids that share a token share one run (ISC-115, ISC-115.1). The words between the claims come from the app language's
 * `Intl.ListFormat`, so neither the sentence's word order nor the list joiner lives in the template.
 */
export function alertParts(sentence: string, session: string, claims: readonly string[], joiner: Intl.ListFormat): AlertPart[] {
  const list = joiner.formatToParts(claims).map((p): RunPiece => ({ id: p.type === 'element', text: p.value }));
  const pieces = sentence.split(SESSION).flatMap((chunk, i): RunPiece[] => [
    ...(i > 0 ? [{ id: true, text: session }] : []),
    ...chunk.split(CLAIMS).flatMap((piece, j) => [...(j > 0 ? list : []), { id: false, text: piece }]),
  ]);
  const out: AlertPart[] = [];
  const pushText = (text: string): void => {
    if (text === '') return;
    const last = out.at(-1);
    if (last?.kind === 'text') out[out.length - 1] = { kind: 'text', text: last.text + text };
    else out.push({ kind: 'text', text });
  };
  let token: RunPiece[] = [];
  const flush = (): void => {
    if (token.some((p) => p.id)) out.push({ kind: 'run', pieces: token });
    else pushText(token.map((p) => p.text).join(''));
    token = [];
  };
  for (const piece of pieces) {
    if (piece.id) {
      token.push(piece);
      continue;
    }
    piece.text.split(BREAK).forEach((chunk, k) => {
      if (k % 2 === 1) {
        flush();
        pushText(chunk);
      } else if (chunk !== '') {
        token.push({ id: false, text: chunk });
      }
    });
  }
  flush();
  return out;
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
      @for (alert of alerts(); track alert.key) {
        @let agent = alert.agent;
        <div class="alert" data-stale-agent [attr.data-session]="agent.session" [attr.data-source]="agent.source">
          <ui-icon name="triangle-alert" [size]="16" />
          <div class="alert-body">
            <p>
              @for (part of alert.parts; track $index) {
                @if (part.kind === 'run') {
                  <span class="id-run">
                    @for (piece of part.pieces; track $index) {
                      @if (piece.id) {
                        <span class="id" data-alert-id>{{ piece.text }}</span>
                      } @else {
                        <ng-container>{{ piece.text }}</ng-container>
                      }
                    }
                  </span>
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
    return {
      sentence: this.transloco.translate('board.agent.staleAlert', ALERT_PLACEHOLDERS, lang),
      joiner: new Intl.ListFormat(lang, { type: 'conjunction' }),
    };
  });
  /** Each stale agent with its sentence in parts; none until the catalogue is there, so no alert renders without words. */
  protected readonly alerts = computed(() => {
    const copy = this.copy();
    if (copy === null) return [];
    // Core builds every agent from a lock, so a stale agent holds at least one claim (core/src/live.ts agentsOf).
    // Keyed by source and session: core groups agents by both, so one session can stand stale in two lock sources.
    return this.stale().map((agent) => ({
      key: agentKey(agent),
      agent,
      parts: alertParts(copy.sentence, agent.session, agent.claims, copy.joiner),
    }));
  });

  protected edge(card: FrameCard): string {
    return toneMark(glyphSpec(card.state, 'card').tone);
  }
}
