import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import type { RepoFileSource } from '../../../../../../core/src/files';
import { UiChip } from '../chip/chip';

/**
 * The source chip (spec 039, ISC-209): a repository file — the TL;DR, a story, a library document such as `tech.md` —
 * read from a spec worktree's copy instead of the main checkout's says so, on a `ui-chip` `plain` in tone `neutral`
 * with `git-branch` and the visible words "from worktree NNN-slug" (`sourceChip.text`, the path's last segment); the
 * whole path and that the main checkout was not read are its `title` and accessible name (`sourceChip.title`). For a
 * file read from the main checkout (`source` absent or `main`) the host renders nothing and is `hidden`: the main
 * checkout is the normal case and carries no chip.
 */
@Component({
  selector: 'ui-source-chip',
  imports: [TranslocoPipe, UiChip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[attr.hidden]': "worktree() === null ? '' : null",
    '[attr.data-source-chip]': 'worktree()',
  },
  styleUrl: './source-chip.css',
  templateUrl: './source-chip.html',
})
export class UiSourceChip {
  /** Where the file was read; absent or `main` renders nothing. */
  readonly source = input<RepoFileSource | null | undefined>(undefined);

  /** The worktree's path relative to the repository root, or null for the main checkout. */
  protected readonly worktree = computed(() => {
    const source = this.source();
    return source?.kind === 'worktree' ? source.worktree : null;
  });

  /** The path's last segment, `012-harbor` for `.worktrees/012-harbor`. */
  protected readonly name = computed(() => this.worktree()?.split('/').at(-1) ?? '');
}
