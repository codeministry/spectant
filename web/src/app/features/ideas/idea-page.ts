import { afterRenderEffect, ChangeDetectionStrategy, Component, computed, effect, ElementRef, inject, resource, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import type { IdeaPage as IdeaPageBody } from '../../../../../server/src/contracts/spec-routes.contract';
import { ApiClient, type ApiResult } from '../../core/api.service';
import { DetailSelection, selectedLook } from '../../layout/detail-sidebar/selection';
import { NotFound } from '../../layout/not-found/not-found';
import { ShellData } from '../../layout/shell/shell-data.service';
import { ShellState } from '../../layout/shell/shell-state.service';
import { UiIcon } from '../../shared/icons/icon';
import { UiButton } from '../../shared/ui/button/button';
import { UiCard, UiChip, UiDocProse, UiNotice, UiPriority, UiSkeleton, UiSourceChip, UiTypeGlyph } from '../../shared/ui';
import { UiPageHead } from '../../shared/ui/page-head/page-head';

/**
 * A story of `specs/ideas/` at `/w/:ws/ideas/:slug` (spec 008, T131, ISC-124.2), read-only, in the look of
 * spec 024 design.md § Idee:
 * - the head (`spec-head-unified`): the back link to the board (ISC-142) and the eyebrow `<ws> · Board · Idea`, the
 *   chip row (the violet `IDEA` chip with `lightbulb`, type, feature, milestone with its flag, priority), the slug as
 *   the h1 (Sora 24/600) with the file path and the hash's first 8 hex in mono beneath;
 * - the main column: the idea quote with the Goal sentence (`idea-quote big`), the "Next step" card with the shaping
 *   command, and the prose card through the Docs tab's renderer `ui-doc-prose`;
 * - from 1120 (wide) the `CONTENTS` column, sticky at 88 px, the active section in cyan-text with a 2 px edge, then
 *   the `SHAPING RECORD`; below wide the "On this page" disclosure above the prose (ui-doc-prose's own fold).
 * The page offers no button and no write control: the commands are shown as text to select, allocation happens on the
 * board. A slug the planning tree does not list, an unknown workspace or a 404 of the story route renders the
 * not-found page (ISC-71); unknown while the tree loads, so nothing flashes.
 */
@Component({
  selector: 'app-idea-page',
  imports: [NotFound, RouterLink, TranslocoPipe, UiButton, UiCard, UiChip, UiDocProse, UiIcon, UiNotice, UiPageHead, UiPriority, UiSkeleton, UiSourceChip, UiTypeGlyph],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-page': 'idea', '[attr.data-tier]': 'state.tier()' },
  styleUrls: ['../../layout/detail-sidebar/selection.css', './idea-page.css'],
  templateUrl: './idea-page.html',
})
export class IdeaPage {
  protected readonly state = inject(ShellState);
  private readonly data = inject(ShellData);
  private readonly api = inject(ApiClient);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  protected readonly slug = computed(() => this.state.route().ideaSlug ?? '');
  private readonly selection = inject(DetailSelection);
  /** The idea as the detail sidebar names it (spec 026, T28): `idea:<slug>`; the head link selects it (`?sel=`). */
  protected readonly ref = computed(() => `idea:${this.slug()}` as const);
  protected readonly look = computed(() => selectedLook(this.selection, this.ref(), 'card'));
  /** The board the back link leads to (ISC-142). */
  protected readonly boardPath = computed(() => `/w/${this.state.ws() ?? ''}/board`);
  /** The shaping command the Next step card names (`next-step`). */
  protected readonly command = computed(() => `/spec idea ${this.slug()}`);

  protected readonly result = resource<ApiResult<IdeaPageBody>, { ws: string; slug: string } | undefined>({
    params: () => {
      const ws = this.state.ws();
      const slug = this.slug();
      return ws !== null && slug !== '' ? { ws, slug } : undefined;
    },
    loader: ({ params }) => this.api.idea(params.ws, params.slug),
  });

  /** The answer; undefined while loading and when the loader threw (an errored resource throws on `value()`). */
  private readonly answer = computed(() => (this.result.hasValue() ? this.result.value() : undefined));

  protected readonly story = computed<IdeaPageBody | null>(() => {
    const value = this.answer();
    return value?.kind === 'ok' ? value.body : null;
  });
  protected readonly failed = computed(() => {
    const kind = this.answer()?.kind;
    return this.result.error() !== undefined || kind === 'error' || kind === 'unavailable' || kind === 'not-found';
  });
  /** The technical hint: the first 8 hex of the story file's raw sha256. */
  protected readonly shortHash = computed(() => this.story()?.hash.slice(0, 8) ?? '');

  protected readonly missing = computed(() => {
    if (this.data.workspaceMissing() || this.data.planningMissing()) return true;
    const value = this.answer();
    if (value?.kind === 'not-found' && value.served) return true;
    return this.data.planningModel() !== null && !this.data.ideas().some((idea) => idea.slug === this.slug());
  });

  /**
   * The page handed to the renderer: at wide without its TOC, because the CONTENTS column beside the main column
   * carries it there; below wide as served, so the renderer draws its "On this page" disclosure above the prose.
   */
  protected readonly prosePage = computed(() => {
    const page = this.story()?.page;
    if (page === undefined) return null;
    return this.state.tier() === 'wide' ? { ...page, toc: [] } : page;
  });

  /** The section the CONTENTS column marks: the last heading above the sticky line, the first one before any. */
  protected readonly active = signal<string | null>(null);

  constructor() {
    const onScroll = (): void => {
      const toc = this.story()?.page.toc ?? [];
      let current = toc[0]?.anchor ?? null;
      for (const entry of toc) {
        const heading = this.host.querySelector<HTMLElement>(`[id="${entry.anchor.replaceAll('"', '')}"]`);
        if (heading !== null && heading.getBoundingClientRect().top <= 96) current = entry.anchor;
      }
      if (current !== this.active()) this.active.set(current);
    };
    // Registered only while the story has a table of contents (spec 057): without one there is no section to mark,
    // and every scroll in the window would still run the heading lookup. The cleanup runs when the TOC goes and on destroy.
    const hasToc = computed(() => (this.story()?.page.toc.length ?? 0) > 0);
    effect((onCleanup) => {
      if (!hasToc()) return;
      addEventListener('scroll', onScroll, { passive: true, capture: true });
      onCleanup(() => removeEventListener('scroll', onScroll, { capture: true }));
    });
    afterRenderEffect(() => {
      if (this.story() !== null && this.state.tier() === 'wide') onScroll();
    });
  }

  /** CONTENTS link: scroll the heading into view, move focus to it, and put its anchor in the URL (as ui-doc-prose). */
  protected jump(event: Event, anchor: string): void {
    event.preventDefault();
    const heading = this.host.querySelector<HTMLElement>(`.docs-prose [id="${anchor.replaceAll('"', '')}"]`);
    if (!heading) return;
    heading.setAttribute('tabindex', '-1');
    heading.scrollIntoView({ block: 'start' });
    heading.focus({ preventScroll: true });
    this.active.set(anchor);
    void this.router.navigate([], { relativeTo: this.route, fragment: anchor, queryParamsHandling: 'preserve', replaceUrl: true });
  }
}
