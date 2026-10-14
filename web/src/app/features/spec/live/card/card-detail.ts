import { ChangeDetectionStrategy, Component, computed, inject, input, model, resource } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import type { FrameCard, LiveCard } from '../../../../../../../core/src/files';
import { ApiClient } from '../../../../core/api.service';
import { ShellState } from '../../../../layout/shell/shell-state.service';
import { UiIcon } from '../../../../shared/icons/icon';
import { UiGlyph } from '../../../../shared/ui/glyph/glyph';
import { stateKey } from '../../../../shared/ui/glyph/states';
import { UiKbd } from '../../../../shared/ui/kbd/kbd';
import { UiDialog } from '../../../../shared/ui/overlay/dialog';
import { UiStateChip } from '../../../../shared/ui/state-chip/state-chip';
import { agentOfCard } from '../live-frame';
import { AgentChip } from '../this-frame/agent-chip';
import type { CardHistoryEntry } from './card-history';
import { CardContext } from './card-context';

/**
 * The card detail (design.md § Live, card detail; ISC-88; spec 024: the prototype `.cdetail`): a `ui-dialog`, full
 * screen at the compact tier and centred above it. The head is the prototype's `.cd-head` (glyph, mono id and claim,
 * state chip, `lane · frame`, close), then the full text, the task's path chips (`.cd-paths`, from the tasks.md line
 * core parsed) and the `.cd-dl`: reason, builder and reader with their icons and verdict dot, tries, note, the probe of
 * the claim's mapping row, the agent holding the lock; the state history across the frames (`card-history.ts`); last
 * the links Open claim · Evidence · Timeline entry and `←` `→`, which step to the previous or next card on the board.
 * `history` is null while the frames load.
 */
@Component({
  selector: 'app-card-detail',
  imports: [AgentChip, RouterLink, TranslocoPipe, UiDialog, UiGlyph, UiIcon, UiKbd, UiStateChip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(keydown)': 'onKey($event)' },
  styles: `
    :host { display: contents; }
    .body { display: grid; gap: 12px; min-inline-size: 0; }
    .cd-head { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; min-inline-size: 0; }
    .cd-head .id { font-family: var(--font-mono); font-weight: 600; }
    .cd-head .claim { font-family: var(--font-mono); font-size: 13px; color: var(--muted); }
    .cd-head .grow { flex: 1; }
    .meta { color: var(--muted); font-size: 12px; line-height: 16px; }
    .close { display: inline-grid; place-items: center; inline-size: 32px; block-size: 32px; padding: 0; border: 1px solid var(--line); border-radius: var(--radius-field); background: var(--color-base-100); color: var(--muted); cursor: pointer; }
    .close:hover { background: var(--color-base-300); color: var(--color-base-content); }
    .text { margin: 0; font-size: 15px; line-height: 22px; overflow-wrap: anywhere; }
    .cd-paths { display: flex; flex-wrap: wrap; gap: 6px; }
    .pathchip { padding: 1px 6px; border-radius: 4px; background: var(--color-base-300); font-family: var(--font-mono); font-size: 11px; line-height: 16px; overflow-wrap: anywhere; }
    .cd-dl { display: grid; grid-template-columns: 96px minmax(0, 1fr); gap: 8px 12px; margin: 4px 0; font-size: 13px; }
    .cd-dl dt { color: var(--muted); font-size: 12px; }
    .cd-dl dd { margin: 0; min-inline-size: 0; overflow-wrap: anywhere; }
    .cd-dl dd.mono { font-size: 12px; line-height: 18px; }
    .cd-dl .red { color: var(--fail-text); }
    .cd-dl ui-icon { vertical-align: -2px; }
    .vdot { display: inline-block; inline-size: 7px; block-size: 7px; margin-inline: 4px 2px; border-radius: 50%; background: var(--muted); }
    .vdot[data-verdict="pass"] { background: var(--color-accent); }
    .vdot[data-verdict="concerns"] { background: var(--conc); }
    .vdot[data-verdict="fail"] { background: var(--color-error); }
    .mono { font-family: var(--font-mono); }
    .num { font-variant-numeric: tabular-nums; }
    h3 { margin: 0; font-size: 13px; font-weight: 600; }
    ol { display: grid; gap: 4px; margin: 0; padding: 0; list-style: none; font-size: 13px; }
    li { display: flex; gap: 8px; align-items: center; min-block-size: 24px; }
    .frame { min-inline-size: 88px; font-family: var(--font-mono); color: var(--muted-ink); }
    .muted { margin: 0; color: var(--muted-ink); font-size: 13px; }
    .cd-links { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    .cd-links .push { display: inline-flex; gap: 4px; align-items: center; margin-inline-start: auto; }
    @container shell (width < 640px) { .cd-dl { grid-template-columns: minmax(0, 1fr); gap: 2px; } .cd-dl dd { margin-block-end: 8px; } }
  `,
  template: `
    @let c = card();
    <ui-dialog
      [attr.data-fullscreen]="compact() ? '' : null"
      [(open)]="open"
      [label]="'board.detail.heading' | transloco: { task: c.task, claim: c.claim }"
    >
      <div class="body" data-card-detail [attr.data-task]="c.task">
        <header class="cd-head" data-detail-head>
          <ui-glyph [state]="c.state" family="card" [size]="20" />
          <b class="id">{{ c.task }}</b>
          <span class="claim">{{ c.claim }}</span>
          <ui-state-chip [state]="c.state" family="card" />
          <span class="grow"></span>
          <span class="meta" data-detail-where>{{ c.lane }}@if (frameLabel(); as label) { · {{ label }}}</span>
          <button type="button" class="close" data-detail-close [attr.aria-label]="'common.close' | transloco" (click)="open.set(false)"><ui-icon name="x" [size]="16" /></button>
        </header>
        <p class="text" data-detail-text>{{ c.text }}</p>
        @if (paths().length > 0) {
          <div class="cd-paths" data-detail-paths>
            @for (p of paths(); track p) {
              <span class="pathchip">{{ p }}</span>
            }
          </div>
        }
        <dl class="cd-dl">
          @if (c.reason) {
            <dt>{{ 'board.detail.reason' | transloco }}</dt>
            <dd>{{ c.reason }}</dd>
          }
          @if (c.builder) {
            <dt>{{ 'board.detail.builder' | transloco }}</dt>
            <dd><ui-icon name="wrench" [size]="13" /> <span data-detail-builder>{{ c.builder }}</span></dd>
          }
          @if (c.reader) {
            <dt>{{ 'board.detail.reader' | transloco }}</dt>
            <dd><ui-icon name="eye" [size]="13" /> {{ c.reader }}@if (c.verdict) { · <i class="vdot" [attr.data-verdict]="c.verdict"></i>{{ c.verdict }}}</dd>
          }
          <dt>{{ 'board.detail.tries' | transloco }}</dt>
          <dd class="num" data-detail-tries>{{ c.tries }}</dd>
          @if (c.note) {
            <dt>{{ 'board.detail.note' | transloco }}</dt>
            <dd class="mono red" data-detail-note>{{ c.note }}</dd>
          }
          @if (probe(); as probe) {
            <dt>{{ 'board.detail.probe' | transloco }}</dt>
            <dd class="mono" data-detail-probe>{{ probe }}</dd>
          }
          @if (agent(); as agent) {
            <dt>{{ 'board.detail.agent' | transloco }}</dt>
            <dd data-detail-session><app-agent-chip [session]="agent.session" [since]="agent.since" [stale]="agent.stale" /></dd>
          }
        </dl>
        <h3>{{ 'board.detail.history' | transloco }}</h3>
        @if (history(); as steps) {
          @if (steps.length > 0) {
            <ol data-history>
              @for (step of steps; track step.frame) {
                <li [attr.data-history-frame]="step.frame" [attr.data-history-state]="step.state">
                  <span class="frame">{{ step.label }}</span>
                  <ui-glyph [state]="step.state" family="card" [size]="14" />
                  <span>{{ word(step) | transloco }}</span>
                </li>
              }
            </ol>
          } @else {
            <p class="muted" data-history-empty>{{ 'board.detail.historyEmpty' | transloco }}</p>
          }
        } @else {
          <p class="muted" data-history-loading>{{ 'common.loading' | transloco }}</p>
        }
        @if (specLink(); as base) {
          <div class="cd-links" data-detail-links>
            <a class="btn btn-sm" [routerLink]="[...base, 'claims']">{{ 'board.detail.openClaim' | transloco }}</a>
            <a class="btn btn-sm" [routerLink]="[...base, 'library']" [queryParams]="{ type: 'evidence' }">{{ 'board.detail.evidence' | transloco }}</a>
            <a class="btn btn-sm" [routerLink]="[...base, 'timeline']">{{ 'board.detail.timeline' | transloco }}</a>
            <span class="meta push"><ui-kbd>←</ui-kbd><ui-kbd>→</ui-kbd> {{ 'board.detail.step' | transloco }}</span>
          </div>
        }
      </div>
    </ui-dialog>
  `,
})
export class CardDetail {
  private readonly shell = inject(ShellState);
  private readonly api = inject(ApiClient);
  private readonly context = inject(CardContext, { optional: true });

  readonly card = input.required<FrameCard | LiveCard>();
  readonly history = input<readonly CardHistoryEntry[] | null>(null);
  readonly open = model(false);

  protected readonly compact = computed(() => this.shell.tier() === 'compact');
  protected readonly frameLabel = computed(() => this.context?.frameLabel() ?? null);
  protected readonly agent = computed(() => agentOfCard(this.card()));
  protected readonly specLink = computed(() => {
    const ws = this.shell.ws();
    const id = this.shell.specId();
    return ws === null || id === null ? null : ['/w', ws, 's', id];
  });

  /** The tasks.md read (core's parse, served by the server): the task's paths and its claim's probe. */
  private readonly tasks = resource({
    params: () => {
      const ws = this.shell.ws();
      const id = this.shell.specId();
      return this.open() && ws !== null && id !== null ? { ws, id } : undefined;
    },
    loader: ({ params }) => this.api.tasks(params.ws, params.id),
  });
  private readonly body = computed(() => {
    if (!this.tasks.hasValue()) return null;
    const result = this.tasks.value();
    return result.kind === 'ok' ? (result.body ?? null) : null;
  });
  protected readonly paths = computed<readonly string[]>(() => this.body()?.tasks.find((t) => t.id === this.card().task)?.paths ?? []);
  protected readonly probe = computed(() => this.body()?.probeMapping.find((m) => m.claim === this.card().claim)?.probe ?? null);

  protected word(step: CardHistoryEntry): string {
    return stateKey(step.state, 'card');
  }

  /** `←` / `→`: the previous or next card in board order (the prototype's `cardOrder`), opened in its place. */
  protected onKey(event: KeyboardEvent): void {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target as HTMLElement | null;
    if (target !== null && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
    const order = [...new Set([...document.querySelectorAll<HTMLElement>('article[data-card]')].map((el) => el.dataset['card'] ?? ''))];
    const i = order.indexOf(this.card().task);
    const next = i < 0 ? undefined : order[i + (event.key === 'ArrowRight' ? 1 : -1)];
    if (next === undefined) return;
    event.preventDefault();
    this.open.set(false);
    setTimeout(() => document.querySelector<HTMLButtonElement>(`article[data-card="${CSS.escape(next)}"] button.id`)?.click());
  }
}
