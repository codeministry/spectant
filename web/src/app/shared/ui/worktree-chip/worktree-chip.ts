import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, DOCUMENT, inject, input, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import type { SpecSource, Worktree } from '../../../../../../core/src/files';
import { UiIcon } from '../../icons/icon';
import { UiIconButton } from '../button/icon-button';
import { UiChip } from '../chip/chip';
import { writeClipboard } from '../command-chip/command-chip';
import { UiPopover, UiPopoverTrigger } from '../overlay/popover';
import { type SheetTier, UiSheet } from '../overlay/sheet';
import { ToastService } from '../toast/toast';
import { toneInk } from '../tone';

/** The chip's marks: symbols, not words, and the same in every language; the words live in the accessible name. */
const MARK = { ahead: '↑', dirty: '±', sep: '·' } as const;

/** `feature/027-worktree-live-view` → `feature/` (muted, kept) · `027` (kept) · `-worktree-live-view` (truncates). */
const BRANCH = /^(.*\/)?(\d{3,})?(.*)$/s;

interface BranchParts {
  readonly prefix: string;
  readonly num: string;
  readonly tail: string;
}

const splitBranch = (branch: string): BranchParts => {
  const [, prefix = '', num = '', tail = ''] = BRANCH.exec(branch) ?? [];
  return { prefix, num, tail };
};

/**
 * The worktree chip (spec 027, ISC-175, design.md § Across viewports 1, 2, 6): where a spec's worktree stands,
 * on a `ui-chip` in tone `neutral` — `warning` for the whole chip when the row carries a `worktree-branch-mismatch`
 * warning (`mismatch`).
 *
 * - **Full** (spec head): `git-branch` 14 px · the branch in mono 12 px, `feature/` muted and `NNN-slug` in the text
 *   colour, only the slug truncating at its end · `↑n` (`↑0` shown) · `±` in the warning ink when dirty.
 * - **Compact** (`compact`, board card): `git-branch` 12 px · `↑n` · `±`; the branch only in the accessible name and
 *   `title`. A card at least 280 px wide shows the full form: the query names the container `board-card`, which the
 *   card declares (`container: board-card / inline-size`).
 *
 * The accessible name is one sentence from `worktreeChip.*` ("Worktree …, branch …, 2 commits ahead of main,
 * uncommitted changes"). `interactive` (default) makes the chip a `<button>` with a 44 px hit area that opens ONE
 * details list — path with copy, full branch, commits ahead, working tree, and the source when the spec is read from
 * its worktree copy — in a `ui-popover` at `medium` / `wide` and in a bottom `ui-sheet` at `compact` (`tier`, fed by
 * the shell as on `ui-sheet`); focus returns to the chip and Escape closes. A non-interactive chip (a card is its own
 * tap target) renders no button and no details. No transition: the chip comes and goes with the refresh tick.
 */
@Component({
  selector: 'ui-worktree-chip',
  imports: [NgTemplateOutlet, TranslocoPipe, UiChip, UiIcon, UiIconButton, UiPopover, UiPopoverTrigger, UiSheet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './worktree-chip.css',
  host: {
    '[attr.data-form]': "compact() ? 'compact' : 'full'",
    '[attr.data-mismatch]': "mismatch() ? '' : null",
    '[style.--worktree-dirty-ink]': 'dirtyInk',
  },
  template: `
    <ng-template #face>
      <ui-chip class="face" variant="plain" aria-hidden="true" [tone]="mismatch() ? 'warning' : 'neutral'">
        <ui-icon name="git-branch" [size]="compact() ? 12 : 14" />
        <span class="branch">
          @if (branch(); as parts) {
            <span class="prefix">{{ parts.prefix }}</span><span class="num">{{ parts.num }}</span><span class="tail">{{ parts.tail }}</span>
          } @else {
            <span class="tail">{{ 'worktreeChip.detached' | transloco }}</span>
          }
        </span>
        @if (worktree().ahead !== null) {
          <span class="sep">{{ mark.sep }}</span>
          <span class="ahead">{{ mark.ahead }}{{ worktree().ahead }}</span>
        }
        @if (worktree().dirty) {
          <span class="dirty">{{ mark.dirty }}</span>
        }
      </ui-chip>
    </ng-template>

    <ng-template #details>
      <dl class="details">
        <div>
          <dt>{{ 'worktreeChip.path' | transloco }}</dt>
          <dd class="path">
            <span class="mono">{{ worktree().path }}</span>
            <button ui-icon-button class="copy" icon="copy" size="sm" [label]="'worktreeChip.copyPath' | transloco" (click)="copyPath()"></button>
          </dd>
        </div>
        <div>
          <dt>{{ 'worktreeChip.branch' | transloco }}</dt>
          <dd class="mono">{{ worktree().branch ?? ('worktreeChip.detached' | transloco) }}</dd>
        </div>
        <div>
          <dt>{{ 'worktreeChip.commits' | transloco }}</dt>
          <dd class="count">{{ aheadText() }}</dd>
        </div>
        <div>
          <dt>{{ 'worktreeChip.changes' | transloco }}</dt>
          <dd>{{ changesText() }}</dd>
        </div>
        @if (source() === 'worktree') {
          <div>
            <dt>{{ 'worktreeChip.source' | transloco }}</dt>
            <dd>{{ 'worktreeChip.sourceWorktree' | transloco }}</dd>
          </div>
        }
      </dl>
    </ng-template>

    @if (!interactive()) {
      <span class="static" [attr.title]="worktree().branch ?? worktree().path">
        <span class="vh">{{ name() }}</span>
        <ng-container [ngTemplateOutlet]="face" />
      </span>
    } @else if (tier() === 'compact') {
      <button type="button" class="trigger" aria-haspopup="dialog" [attr.aria-label]="name()" [attr.aria-expanded]="sheetOpen()" (click)="sheetOpen.set(true)">
        <ng-container [ngTemplateOutlet]="face" />
      </button>
      <ui-sheet tier="compact" [(open)]="sheetOpen" [heading]="'worktreeChip.details' | transloco">
        <ng-container [ngTemplateOutlet]="details" />
      </ui-sheet>
    } @else {
      <button type="button" class="trigger" aria-haspopup="dialog" [attr.aria-label]="name()" [uiPopoverTrigger]="pop">
        <ng-container [ngTemplateOutlet]="face" />
      </button>
      <ui-popover #pop [label]="'worktreeChip.details' | transloco">
        <ng-container [ngTemplateOutlet]="details" />
      </ui-popover>
    }
  `,
})
export class UiWorktreeChip {
  readonly worktree = input.required<Worktree>();
  /** The board card's form: icon, `↑n` and `±` only, the branch in the accessible name (full from a 280 px card). */
  readonly compact = input(false);
  /** A `<button>` opening the details; false on a card, which is its own tap target. */
  readonly interactive = input(true);
  /** The row carries a `worktree-branch-mismatch` warning: the whole chip takes the `warning` tone. */
  readonly mismatch = input(false);
  /** Where the app reads the spec's files; `worktree` adds the "Worktree copy" row to the details. */
  readonly source = input<SpecSource>('main');
  /** The shell's tier: `compact` opens the details as a bottom sheet, `medium` / `wide` as a popover. */
  readonly tier = input<SheetTier>('medium');

  protected readonly mark = MARK;
  protected readonly dirtyInk = toneInk('warning');
  protected readonly sheetOpen = signal(false);

  private readonly transloco = inject(TranslocoService);
  private readonly toast = inject(ToastService);
  private readonly doc = inject(DOCUMENT);
  private readonly lang = toSignal(this.transloco.langChanges$, { initialValue: this.transloco.getActiveLang() });

  protected readonly branch = computed(() => {
    const branch = this.worktree().branch;
    return branch === null ? null : splitBranch(branch);
  });

  private readonly t = (key: string, params?: Record<string, unknown>): string =>
    this.transloco.translate(key, params, this.lang());

  protected readonly aheadText = computed(() => {
    const ahead = this.worktree().ahead;
    if (ahead === null) return this.t('common.noValue');
    return this.t(ahead === 1 ? 'worktreeChip.ahead.one' : 'worktreeChip.ahead.other', { count: ahead });
  });

  protected readonly changesText = computed(() => {
    const dirty = this.worktree().dirty;
    if (dirty === null) return this.t('common.noValue');
    return this.t(dirty ? 'worktreeChip.changesDirty' : 'worktreeChip.changesClean');
  });

  /** One sentence: where, which branch, how far ahead, whether dirty, and the mismatch the tone shows. */
  protected readonly name = computed(() => {
    const { path, branch, ahead, dirty } = this.worktree();
    const parts = [branch === null ? this.t('worktreeChip.nameDetached', { path }) : this.t('worktreeChip.name', { path, branch })];
    if (ahead !== null) parts.push(this.aheadText());
    if (dirty === true) parts.push(this.t('worktreeChip.dirty'));
    if (this.mismatch()) parts.push(this.t('worktreeChip.mismatch'));
    return parts.join(', ');
  });

  protected async copyPath(): Promise<void> {
    const path = this.worktree().path;
    if (path !== null && (await writeClipboard(path, this.doc))) this.toast.show(this.t('worktreeChip.copied'));
  }
}
