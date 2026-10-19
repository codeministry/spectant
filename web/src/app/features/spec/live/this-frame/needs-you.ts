import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, untracked, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import type { Frame, FrameCard, LiveFrame, NeedsYouCard, OpenQuestion, TaskSteps } from '../../../../../../../core/src/files';
import { UiIcon } from '../../../../shared/icons/icon';
import { UiTime } from '../../../../shared/time';
import { UiGlyph } from '../../../../shared/ui/glyph/glyph';
import { glyphSpec } from '../../../../shared/ui/glyph/states';
import { UiLiveRegion } from '../../../../shared/ui/live-region/live-region';
import { UiStateChip } from '../../../../shared/ui/state-chip/state-chip';
import { toneMark } from '../../../../shared/ui/tone';
import { agentKey, staleAgents } from '../live-frame';
import { AgentChip } from './agent-chip';
import { RAIL_BLOCK_STYLES } from './rail-block.styles';

/** A Needs you card with its task's open question (spec 015, ISC-232.1). */
export type QuestionCard = FrameCard & { readonly question: OpenQuestion };

/** The card's open question, when core put one on it; a history frame's cards and the board's cards never carry one. */
export function openQuestionOf(card: FrameCard | NeedsYouCard): OpenQuestion | null {
  return 'question' in card && card.question !== undefined ? card.question : null;
}

/** One key per asked question: the task and the step's time, so the same task asking again is a new question. */
export function questionKey(task: string, question: OpenQuestion): string {
  return `${task}\u0000${question.ts}`;
}

/**
 * Who asked: the session of the task's latest `question` step at the question's time (the steps the live answer sends
 * beside the frame), else the session holding the card's lock; null when neither is known, so no chip is guessed.
 */
export function askingSession(card: FrameCard, question: OpenQuestion, steps: TaskSteps | null): string | null {
  const asked = (steps?.[card.task] ?? []).filter((s) => s.kind === 'question');
  const step = asked.find((s) => s.ts === question.ts) ?? asked.at(-1);
  return step?.actor ?? card.lock?.session ?? null;
}

/**
 * The questions in `current` that `seen` does not hold yet, in list order: what the live region announces after a
 * refresh (design.md: only a newly asked question is read out, never another step).
 */
export function newlyAsked(seen: ReadonlySet<string>, current: readonly FrameCard[]): QuestionCard[] {
  return current.flatMap((card) => {
    const question = openQuestionOf(card);
    return question === null || seen.has(questionKey(card.task, question)) ? [] : [{ ...card, question }];
  });
}

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
 * Spec 015 (T17, ISC-232.1): a card with an open question renders as a question entry in both places: the id (opens the
 * card), the claim and the asked time as `HH:MM`, the question in full (core keeps at most 200 characters), then the
 * kind word and the asking session's agent chip, which says where to answer; there is no answer action (no write path).
 * A polite live region announces a newly asked question only, never another step.
 */
@Component({
  selector: 'app-needs-you',
  imports: [AgentChip, NgTemplateOutlet, TranslocoPipe, UiGlyph, UiIcon, UiLiveRegion, UiStateChip, UiTime],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-needs-you': '' },
  styles: [
    RAIL_BLOCK_STYLES,
    `
      .count { font-variant-numeric: tabular-nums; }
      .op-eb { margin: 8px 0 0; color: var(--muted); font-size: 11px; font-weight: 600; letter-spacing: .08em; line-height: 16px; text-transform: uppercase; }
      /* The id, then the text, the reason under it: a long reason never squeezes the text to nothing. */
      .op-mini { display: grid; box-sizing: border-box; grid-template-columns: auto minmax(0, 1fr); min-inline-size: 0; gap: 2px 8px; align-items: start; inline-size: 100%; min-block-size: 32px; padding: 6px 0; border: 0; border-block-start: 1px solid var(--line); background: none; color: inherit; font: inherit; font-size: 13px; text-align: start; cursor: pointer; }
      .op-mini:hover { background: var(--lane); }
      .op-mini:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
      .op-mini .why { grid-column: 2; min-inline-size: 0; color: var(--muted); font-size: 12px; overflow-wrap: anywhere; }
      /* spec 024: the prototype .needs-card, a 3 px edge in orange on the card. */
      .needs-card { border-inline-start: 3px solid var(--color-warning); }
      @media (forced-colors: active) { .needs-card { border-inline-start-color: CanvasText; } }
      .edge { border-inline-start: 4px solid var(--edge); border-start-start-radius: 0; border-end-start-radius: 0; }
      /* spec 015: an open question, three lines, the text in full; never a tooltip, never cut. */
      .q { display: grid; gap: 4px; min-inline-size: 0; padding: 8px; border-radius: var(--radius-field); font-size: 13px; line-height: var(--rail-line); }
      .q-head, .q-foot { display: flex; flex-wrap: wrap; gap: 4px 8px; align-items: center; min-inline-size: 0; }
      .q-head ui-icon { flex: none; color: var(--muted-ink); }
      .q-id { min-block-size: var(--rail-line); padding: 0; border: 0; background: none; color: inherit; cursor: pointer; }
      .q-id:hover { text-decoration: underline; }
      .q-claim { color: var(--muted-ink); font-family: var(--font-mono); font-size: 12px; }
      .q-time { margin-inline-start: auto; font-family: var(--font-mono); font-size: 12px; }
      .q-text { margin: 0; overflow-wrap: anywhere; }
      .q-kind { color: var(--muted-ink); font-size: 12px; }
      @media (pointer: coarse) { .q-id { min-block-size: 44px; min-inline-size: 44px; } }
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
    <ui-live-region data-needs-announcer />
    @if (framed()) {
      <section class="block needs-card" aria-labelledby="needs-you-heading">
        <h3 class="head eyebrow-head" id="needs-you-heading">
          {{ 'board.rail.needsYou' | transloco }}
          <span class="end count" data-needs-count>{{ cards().length }}</span>
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
            @let q = questionOf(c);
            <li>
              @if (q !== null) {
                @let session = sessionOf(c, q);
                <div class="q edge" [attr.data-needs-question]="c.task" [style.--edge]="questionEdge">
                  <div class="q-head">
                    <ui-icon name="message-circle-question" [size]="14" />
                    <button type="button" class="q-id mono" [attr.data-needs-card]="c.task" [attr.aria-label]="'board.card.open' | transloco: { task: c.task }" (click)="opened.emit(c)">{{ c.task }}</button>
                    <span class="q-claim">{{ c.claim }}</span>
                    <ui-time class="q-time" [value]="q.ts" form="clock" />
                  </div>
                  <p class="q-text" data-question-text>{{ q.text }}</p>
                  <div class="q-foot">
                    <span class="q-kind">{{ 'steps.kind.question' | transloco }}</span>
                    @if (session !== null) {
                      <app-agent-chip [session]="session" />
                    }
                  </div>
                </div>
              } @else {
                <button type="button" class="row edge" [attr.data-needs-card]="c.task" [style.--edge]="edge(c)" (click)="opened.emit(c)">
                  <ui-glyph [state]="c.state" family="card" [size]="14" />
                  <span class="mono">{{ c.task }}</span>
                  <span class="text">{{ c.text }}</span>
                  <ui-state-chip [state]="c.state" family="card" />
                </button>
              }
            </li>
          }
        </ul>
      } @else {
        <p class="empty">{{ 'board.rail.emptyNeeds' | transloco }}</p>
      }
      @if (steps().length > 0) {
        <p class="op-eb" data-needs-steps>{{ 'board.rail.yourSteps' | transloco }}</p>
        @for (s of steps(); track s.task) {
          <button type="button" class="op-mini" [attr.data-op-mini]="s.task" [attr.title]="'board.rail.showStep' | transloco: { task: s.task }" (click)="showStep(s.task)">
            <span class="mono">{{ s.task }}</span><span class="text">{{ s.text }}</span>@if (s.reason) {<span class="why">{{ s.reason }}</span>}
          </button>
        }
      }
    </ng-template>
  `,
})
export class NeedsYou {
  /** The open operator steps (prototype "Your steps" in the Needs you card); each row points at its step on the board. */
  readonly steps = input<readonly FrameCard[]>([]);

  protected showStep(task: string): void {
    const row = document.querySelector<HTMLElement>(`[data-step="${CSS.escape(task)}"]`);
    row?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    row?.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true });
  }

  readonly frame = input.required<Frame | LiveFrame>();
  /**
   * Every task's steps (spec 015), which the live answer sends beside the frame; null reads them off the frame object
   * when the caller passed the answer whole, and a card without them names its lock holder as the asking session.
   */
  readonly taskSteps = input<TaskSteps | null>(null);
  private readonly stepsOfFrame = computed((): TaskSteps | null => {
    const frame = this.frame() as (Frame | LiveFrame) & { readonly steps?: TaskSteps };
    return this.taskSteps() ?? frame.steps ?? null;
  });

  protected readonly questionEdge = toneMark('secondary');
  protected questionOf(card: FrameCard): OpenQuestion | null {
    return openQuestionOf(card);
  }
  protected sessionOf(card: FrameCard, question: OpenQuestion): string | null {
    return askingSession(card, question, this.stepsOfFrame());
  }

  private readonly announcer = viewChild(UiLiveRegion);
  /** The questions already seen; null until the first list arrives, which is the baseline and announces nothing. */
  private seen: Set<string> | null = null;

  constructor() {
    effect(() => {
      const cards = this.cards();
      untracked(() => {
        const fresh = this.seen === null ? [] : newlyAsked(this.seen, cards);
        this.seen = new Set(newlyAsked(new Set(), cards).map((c) => questionKey(c.task, c.question)));
        this.announcer()?.announceAll(fresh.map((c) => this.transloco.translate('steps.needsYou.announce', { task: c.task, text: c.question.text })));
      });
    });
  }

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
