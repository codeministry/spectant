import { ChangeDetectionStrategy, Component, computed, inject, resource } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import type { Frame, MatrixCell, MatrixColumn } from '../../../../../../../core/src/files';
import { ApiClient } from '../../../../core/api.service';
import { ShellData } from '../../../../layout/shell/shell-data.service';
import { ShellState } from '../../../../layout/shell/shell-state.service';
import { UiGlyph } from '../../../../shared/ui/glyph/glyph';
import { stateKey } from '../../../../shared/ui/glyph/states';
import { boardQuery, glyphOf, laneGroups, matrixOf } from './matrix-model';

/**
 * The Matrix tab (T87, ISC-92): tasks × frames from core's `buildMatrix` over the board's frames (`…/frames` and
 * `…/live`), no route of its own. One labelled horizontal scroll region (`role="region"`, focusable, an edge shadow
 * while more columns hide to the right) holds a table whose first column sticks: task ids at compact and medium, id
 * and claim at wide under a lane group header. Every frame cell is a link to the Board at that frame (`?frame=<i>`, the
 * live column to `/board` without it), named by task, frame and state word; a re-cut column sits hatched between the
 * rounds it separates.
 *
 * Tiers (design.md § Live, Matrix): compact 64 px ids and 44 × 44 cells; medium 64 px ids and 32 × 32 cells; wide a
 * 224 px id and claim column, 32 px rows, dispatch 16 px (dimmed), result 28 px, live 40 px, re-cut 8 px.
 */
@Component({
  selector: 'app-matrix-tab',
  imports: [RouterLink, TranslocoPipe, UiGlyph],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-page': 'matrix', '[attr.data-tier]': 'state.tier()' },
  templateUrl: './matrix-tab.html',
  styleUrl: './matrix-tab.css',
})
export class MatrixTab {
  private readonly api = inject(ApiClient);
  private readonly transloco = inject(TranslocoService);
  protected readonly state = inject(ShellState);
  private readonly data = inject(ShellData);

  private readonly params = computed(() => {
    const ws = this.state.ws();
    const id = this.state.specId();
    return ws === null || id === null ? undefined : { ws, id };
  });
  readonly framesResult = resource({ params: () => this.params(), loader: ({ params }) => this.api.frames(params.ws, params.id) });
  readonly liveResult = resource({ params: () => this.params(), loader: ({ params }) => this.api.live(params.ws, params.id) });
  private readonly lang = toSignal(this.transloco.langChanges$, { initialValue: this.transloco.getActiveLang() });

  /** Every frame on the scrubber: the history, then the live frame. */
  private readonly frames = computed<readonly Frame[]>(() => {
    const history = this.framesResult.value();
    const live = this.liveResult.value();
    return [...(history?.kind === 'ok' ? history.body : []), ...(live?.kind === 'ok' ? [live.body] : [])];
  });
  protected readonly loading = computed(() => this.framesResult.isLoading() || this.liveResult.isLoading());
  protected readonly failed = computed(() => {
    const history = this.framesResult.value();
    const live = this.liveResult.value();
    return history !== undefined && live !== undefined && history.kind !== 'ok' && live.kind !== 'ok';
  });

  private readonly lanes = computed<readonly string[]>(() => {
    const spec = this.data.spec.value();
    return spec?.kind === 'ok' ? spec.body.lanes.map((lane) => lane.name) : [];
  });
  protected readonly matrix = computed(() => matrixOf(this.frames(), this.lanes()));
  protected readonly groups = computed(() => laneGroups(this.matrix()));
  protected readonly boardLink = computed(() => ['/w', this.state.ws() ?? '', 's', this.state.specId() ?? '', 'board']);
  /** The accessible name of each column, by column index. */
  protected readonly columnNames = computed(() => {
    this.lang();
    return this.matrix().columns.map((column) => this.columnName(column));
  });

  protected readonly glyphOf = glyphOf;
  protected readonly queryOf = boardQuery;

  /** "T27, R2: Waiting": task, frame and state word; "no card yet" before the first card, "absent" after the last. */
  protected cellLabel(cell: MatrixCell): string {
    const glyph = glyphOf(cell);
    const word = glyph === null ? this.transloco.translate('matrix.cell.none') : this.transloco.translate(stateKey(glyph, 'card'));
    return this.transloco.translate('matrix.cell.label', { task: cell.task, frame: this.columnNames()[cell.column] ?? '', state: word });
  }

  /** The re-cut mark of a cell as words, or '' when the re-cut left the id alone. */
  protected recutLabel(cell: MatrixCell): string {
    return cell.recut === undefined ? '' : this.transloco.translate(`matrix.recut.${cell.recut}`, { task: cell.task });
  }

  private columnName(column: MatrixColumn): string {
    const round = column.frame === null ? null : (this.frames()[column.frame]?.round ?? null);
    switch (column.kind) {
      case 'dispatch':
        return this.transloco.translate('matrix.column.dispatch', { round });
      case 'result':
        return this.transloco.translate('matrix.column.result', { round });
      case 'live':
        return this.transloco.translate('matrix.column.live');
      case 'recut':
        return this.transloco.translate('matrix.column.recut', { label: column.label });
    }
  }
}
