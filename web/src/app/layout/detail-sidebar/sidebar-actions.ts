import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  Injector,
  input,
  linkedSignal,
  signal,
  viewChild,
} from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import type { ItemStateInfo, WorkflowStage } from '../../../../../core/src/files';
import type { PlanningHolder } from '../../../../../core/src/planning';
import type { Relation } from '../../../../../core/src/relations';
import { ApiClient } from '../../core/api.service';
import { dropTargetsOf } from '../../core/model/board';
import { boardRowsOf } from '../../core/model/board-rows';
import { UiIcon } from '../../shared/icons/icon';
import { UiButton } from '../../shared/ui/button/button';
import { nextId } from '../../shared/ui/overlay/ids';
import type { BoardRefusal } from '../../shared/ui/refusal-notice/refusal';
import { RefusalNotice } from '../../shared/ui/refusal-notice/refusal-notice';
import { UiStageTargets } from '../../shared/ui/stage-targets/stage-targets';
import { ToastService } from '../../shared/ui/toast/toast';
import { RunRelease } from '../run-release/run-release';
import { ShellData } from '../shell/shell-data.service';
import { ShellState } from '../shell/shell-state.service';

/** What the stage action knows of the shown spec: the board's view of it (`buildBoard`'s spec card, reduced). */
export interface SidebarStageItem {
  readonly id: string;
  readonly stage: WorkflowStage;
  /** core's transition table from `stage` for the spec's type (`dropTargetsOf`), the board's targets. */
  readonly targets: readonly WorkflowStage[];
  /** spec.md's raw hash as the planning holder carries it; null where no holder names the spec (not movable). */
  readonly hash: string | null;
  /** The dashboard row's item state; a `running` one holds the spec (spec 040). */
  readonly state: ItemStateInfo | null;
}

/** An accepted move the planning tree may not show yet: shown while the served holder still has the hash it was sent with. */
interface SidebarMove {
  readonly id: string;
  readonly from: WorkflowStage;
  readonly to: WorkflowStage;
  readonly hash: string;
  readonly written: string;
}

/** The run-locked refusal of a spec a running run holds (spec 040, T57): its command, actor and duration. */
function runRefusalOf(item: SidebarStageItem): BoardRefusal | null {
  const state = item.state;
  if (state?.state !== 'running') return null;
  const run = state.run;
  return {
    key: `spec:${item.id}`,
    id: item.id,
    stage: item.stage,
    to: item.stage,
    kind: 'run-locked',
    command: run?.command ?? state.command ?? null,
    actor: run?.actor.id ?? null,
    elapsedMs: run?.elapsedMs ?? null,
  };
}

/**
 * The actions of the detail sidebar (spec 067, T28 ISC-533, T30 ISC-534): a grid of two columns, one action alone
 * takes the full width.
 *
 * "Change stage" (a spec on the board only) is a disclosure button (`aria-expanded`) that opens the board's
 * stage-target list (`ul[ui-stage-targets]`, `tall` at compact) inline below the grid and scrolls it into view; never a
 * popover in the fixed panel. The targets are the board's: `dropTargetsOf` over the planning workflow from the spec's
 * stage and type, so every entry the board refuses is disabled here with the same reason. Choosing an entry is the
 * confirmation, as on the board: one `transition` write (write path 3) with the hash of spec.md the planning holder
 * carries. 200 closes the list, keeps focus on the button, toasts and reloads the planning tree and the dashboard; the
 * move shows at once until the tree has caught up (the board's `withMoves`, reduced). 409, 422, 423 and every other
 * answer leave `app-refusal-notice` under the entry and nothing is written; a 409 reloads the tree so the next choice
 * sends the new hash. A running run disables every entry and stands above the list.
 *
 * "Release run" embeds `app-run-release` unchanged for the open run the sidebar passes (`running`); its refresh after
 * a 200 drops the run, so the button leaves and "Change stage" takes the full width.
 */
@Component({
  selector: 'app-sidebar-actions',
  imports: [RefusalNotice, RunRelease, TranslocoPipe, UiButton, UiIcon, UiStageTargets],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    'data-ui': 'sidebar-actions',
    '[attr.data-count]': 'count()',
    '[hidden]': 'count() === 0',
    '(keydown.escape)': 'escape($event)',
  },
  styleUrl: './sidebar-actions.css',
  templateUrl: './sidebar-actions.html',
})
export class SidebarActions {
  /** The selected object's relation entry; a spec gets "Change stage", a spec or story with an open run "Release run". */
  readonly relation = input.required<Relation>();
  /**
   * The shown spec's or story's item while a run line's run is open on it, as the sidebar's state line reads it
   * (`DetailSidebar.running`, `releasableRun`); null shows no release.
   */
  readonly running = input<ItemStateInfo | null>(null);

  private readonly api = inject(ApiClient);
  private readonly data = inject(ShellData);
  private readonly shell = inject(ShellState);
  private readonly toasts = inject(ToastService);
  private readonly transloco = inject(TranslocoService);
  private readonly injector = inject(Injector);

  private readonly toggle = viewChild<unknown, ElementRef<HTMLButtonElement>>('toggle', { read: ElementRef });
  private readonly list = viewChild<ElementRef<HTMLElement>>('list');

  protected readonly listId = nextId('sidebar-stage-list');
  protected readonly compact = computed(() => this.shell.tier() === 'compact');
  protected readonly stages = this.data.stages;

  /** Accepted moves of this sidebar the planning tree may not show yet. */
  private readonly moves = signal<readonly SidebarMove[]>([]);

  /** The shown spec as the board sees it; null for every other type, an archived spec and a spec off the board. */
  readonly item = computed<SidebarStageItem | null>(() => {
    const entry = this.relation();
    const workflow = this.data.workflow();
    const stages = this.data.stages();
    if (entry.type !== 'spec' || entry.archived === true || workflow === null) return null;
    const holder = this.holderOf(entry.id);
    const result = this.data.dashboard.value();
    const row = result?.kind === 'ok' ? boardRowsOf(result.body).find((r) => r.id === entry.id) : undefined;
    const served = holder?.stage ?? entry.stage ?? row?.stage ?? null;
    const servedHash = holder?.hash ?? null;
    if (served === null) return null;
    const move = this.moves().find((m) => m.id === entry.id && m.hash === servedHash && m.from === served);
    const stage = move?.to ?? served;
    if (!stages.includes(stage)) return null;
    const type = row?.type ?? null;
    return {
      id: entry.id,
      stage,
      targets: dropTargetsOf({ kind: 'spec', type, stage }, workflow, stages),
      hash: move?.written ?? servedHash,
      state: row?.state ?? null,
    };
  });

  /** How many actions the grid holds; one takes the full width, none hides the host. */
  protected readonly count = computed(() => (this.item() === null ? 0 : 1) + (this.running() === null ? 0 : 1));

  /** The list is open; closed again whenever another object is selected. */
  protected readonly open = linkedSignal({ source: () => this.relation().ref, computation: () => false });
  /** The refusal of the last choice; cleared with the selection, shown while the spec still stands where it was refused. */
  private readonly refused = linkedSignal<string, BoardRefusal | null>({ source: () => this.relation().ref, computation: () => null });
  protected readonly saving = signal(false);

  protected readonly refusal = computed(() => {
    const refusal = this.refused();
    return refusal !== null && refusal.stage === this.item()?.stage ? refusal : null;
  });
  /** A run's refusal stands above the list: the running state that holds the spec, else a 423 `run-locked` answer. */
  protected readonly runRefusal = computed(() => {
    const item = this.item();
    const own = item === null ? null : runRefusalOf(item);
    const refusal = this.refusal();
    return own ?? (refusal?.kind === 'run-locked' ? refusal : null);
  });
  protected readonly movable = computed(() => {
    const item = this.item();
    return item !== null && item.hash !== null && this.runRefusal() === null && !this.saving();
  });

  protected flip(): void {
    const open = !this.open();
    this.open.set(open);
    if (!open) return;
    afterNextRender(
      () => {
        const list = this.list()?.nativeElement;
        list?.scrollIntoView({ block: 'nearest' });
        list?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
      },
      { injector: this.injector },
    );
  }

  /** Escape closes the list before the sidebar (which skips a prevented Escape) and returns focus to the button. */
  protected escape(event: Event): void {
    if (!this.open()) return;
    event.preventDefault();
    this.close();
  }

  protected dismiss(): void {
    this.refused.set(null);
  }

  /** The one write (path 3): the board's transition with the hash the holder carries. */
  async choose(to: WorkflowStage): Promise<void> {
    const item = this.item();
    const ws = this.shell.ws();
    if (item === null || ws === null || item.hash === null || !this.movable() || to === item.stage) return;
    const hash = item.hash;
    const base = { key: `spec:${item.id}`, id: item.id, stage: item.stage, to };
    this.saving.set(true);
    const result = await this.api.transition(ws, item.id, to, hash);
    this.saving.set(false);
    if (result.kind === 'error') {
      this.refuse({ ...base, kind: 'failed', status: result.status });
      return;
    }
    if (result.kind === 'run-locked') {
      const body = result.body;
      const started = Date.parse(body.since);
      this.refuse({
        ...base,
        kind: 'run-locked',
        command: body.command,
        actor: body.actor.id,
        elapsedMs: Number.isFinite(started) ? Math.max(0, Date.now() - started) : null,
      });
      this.data.dashboard.reload();
      return;
    }
    const answer = result.answer;
    switch (answer.status) {
      case 200: {
        const move: SidebarMove = { id: item.id, from: item.stage, to: answer.body.to, hash, written: answer.body.hash };
        this.moves.update((all) => [...all.filter((m) => m.id !== item.id), move]);
        this.refused.set(null);
        this.close();
        const stage = this.transloco.translate(`stages.${answer.body.to}`);
        this.toasts.show(this.transloco.translate('board.workspace.drag.toast', { id: item.id, stage }));
        this.data.planning.reload();
        this.data.dashboard.reload();
        return;
      }
      case 422:
        this.refuse({ ...base, kind: 'refused', reason: answer.body.reason, command: answer.body.command });
        return;
      case 409:
        this.refuse({ ...base, kind: 'stale' });
        this.data.planning.reload();
        return;
      case 423:
        this.refuse({ ...base, kind: 'locked', session: answer.body.lock.session, claim: answer.body.lock.claim });
        return;
      case 400:
        this.refuse({ ...base, kind: 'failed', status: 400 });
        return;
    }
  }

  private refuse(refusal: BoardRefusal): void {
    this.refused.set(refusal);
  }

  /** Closes the list and keeps focus on the button (the chosen entry leaves with the list). */
  private close(): void {
    this.open.set(false);
    this.toggle()?.nativeElement.focus();
  }

  /** The spec's planning holder: a feature's entry first (the main one wins), then a milestone's. */
  private holderOf(id: string): PlanningHolder | undefined {
    const model = this.data.planningModel();
    if (!model) return undefined;
    const held = model.features.flatMap((f) => f.holders).filter((h) => h.id === id && !h.archived);
    return held.find((h) => h.main) ?? held.at(0) ?? model.milestones.flatMap((m) => m.specs).find((h) => h.id === id && !h.archived);
  }
}
