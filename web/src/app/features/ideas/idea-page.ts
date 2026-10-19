import { afterRenderEffect, ChangeDetectionStrategy, Component, computed, DestroyRef, ElementRef, inject, resource, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import type { IdeaPage as IdeaPageBody } from '../../../../../server/src/spec-routes.contract';
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
 * A story of `specs/ideas/` at `/w/:ws/ideas/:slug` (spec 008, T131, ISC-124.2), read-only, in the prototype look
 * (spec 024 design.md § Idee, `.design/prototype/idea.html`):
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
  styleUrls: ['../../layout/detail-sidebar/selection.css'],
  styles: `
    :host { display: block; min-inline-size: 0; }
    .head { display: grid; gap: 12px; margin-block-end: 24px; padding-block-end: 16px; border-block-end: 1px solid var(--line); }
    /* Prototype spec-head-unified: the path left and the labels right, the h1 directly under them; below 640 the labels
       stack under the path (the prototype's compact rule). */
    .sh-context { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 12px; align-items: end; min-inline-size: 0; }
    .sh-context ui-page-head { min-inline-size: 0; }
    .sh-context .chips { justify-content: flex-end; }
    :host([data-tier='compact']) .sh-context { grid-template-columns: minmax(0, 1fr); gap: 8px; }
    :host([data-tier='compact']) .sh-context .chips { justify-content: flex-start; }
    .sh-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; min-inline-size: 0; }
    .sh-row { display: flex; flex-wrap: wrap; gap: 12px 24px; align-items: flex-end; justify-content: space-between; min-inline-size: 0; }
    .sh-main { display: grid; gap: 4px; min-inline-size: 0; }
    h1 { margin: 0; font-family: var(--font-brand); font-size: 24px; font-weight: 600; line-height: 32px; overflow-wrap: anywhere; }
    :host([data-tier='compact']) h1 { font-size: 20px; line-height: 28px; }
    .chips { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin: 0; padding: 0; list-style: none; }
    .chips li { display: inline-flex; }
    .chip-body { display: inline-flex; gap: 6px; align-items: center; }
    .mono { font-family: var(--font-mono); }
    .unset { color: var(--muted-ink); }
    .hint { margin: 0; color: var(--muted-ink); font-size: 13px; line-height: 20px; overflow-wrap: anywhere; }
    .source { font-family: var(--font-mono); font-size: 12px; font-variant-numeric: tabular-nums; }
    /* Prototype command-chip, as selectable text: mono on the lane surface with the hairline (no copy button here). */
    .cmd { display: inline-flex; align-items: center; min-block-size: 32px; max-inline-size: 100%; padding: 0 10px; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--lane); font-family: var(--font-mono); font-size: 13px; font-weight: 500; line-height: 20px; overflow-wrap: anywhere; user-select: all; }
    .layout { display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; align-items: start; }
    :host([data-tier='wide']) .layout { grid-template-columns: minmax(0, 1fr) 240px; gap: 32px; }
    .col { display: grid; gap: 16px; min-inline-size: 0; }
    /* Prototype idea-quote big: the violet 3 px edge, the Goal sentence in the display face. */
    .idea-quote { display: grid; gap: 6px; margin: 0; padding: 12px 16px; border: 1px solid var(--line); border-inline-start: 3px solid var(--color-secondary); border-radius: 0 var(--radius-card) var(--radius-card) 0; background: var(--color-base-100); }
    .eyebrow { margin: 0; color: var(--muted-ink); font-size: 11px; font-weight: 600; letter-spacing: 0.06em; line-height: 16px; text-transform: uppercase; }
    .eyebrow code { font-family: var(--font-mono); letter-spacing: normal; text-transform: none; }
    blockquote { margin: 0; font-family: var(--font-brand); font-size: 18px; font-weight: 500; line-height: 26px; overflow-wrap: anywhere; }
    .next-step { display: grid; gap: 8px; }
    .why { margin: 0; padding-inline-start: 18px; color: var(--muted-ink); font-size: 13px; line-height: 20px; }
    .ro-hint { display: flex; gap: 6px; align-items: center; margin-block-start: 16px; font-family: var(--font-mono); font-size: 12px; }
    .toc-col { position: sticky; inset-block-start: 88px; display: grid; gap: 24px; min-inline-size: 0; }
    .rail-eyebrow { display: flex; justify-content: space-between; }
    .docs-toc { display: grid; gap: 8px; }
    .toc-list { display: grid; margin: 0; padding: 0; list-style: none; }
    .toc-list a { display: block; padding: 4px 0 4px 12px; border-inline-start: 2px solid var(--line); color: var(--muted-ink); font-size: 13px; line-height: 20px; text-decoration: none; }
    .toc-list a:hover { color: var(--color-base-content); }
    .toc-list a[aria-current='true'] { border-inline-start-color: var(--color-primary); color: var(--disp-ink); font-weight: 600; }
    .toc-list li[data-level='3'] a { padding-inline-start: 24px; }
    .shape-rec { display: grid; gap: 4px; margin: 0; padding: 0; list-style: none; color: var(--muted-ink); font-size: 12px; line-height: 18px; }
    .loading { display: grid; gap: 8px; max-inline-size: 72ch; }
    .visually-hidden { position: absolute; inline-size: 1px; block-size: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  `,
  template: `
    @if (missing()) {
      <app-not-found />
    } @else if (story(); as story) {
      <!-- A div, not a header: the page head's back link belongs to the page, not to a banner (ISC-142). -->
      <div class="head" data-idea-head>
        <div class="sh-context">
          <ui-page-head
            [segments]="[state.ws() ?? '', ('shell.pages.board' | transloco), ('ideas.crumb' | transloco: { slug: story.idea.slug })]"
            [back]="{ href: boardPath(), label: 'orientation.backToBoard' | transloco }"
          />
          <ul class="chips" data-idea-chips [attr.aria-label]="'ideas.meta' | transloco">
            <li data-idea-chip="stage">
              <span class="visually-hidden">{{ 'ideas.chip.stage' | transloco }}</span>
              <ui-chip tone="secondary" icon="lightbulb">{{ 'stages.idea' | transloco }}</ui-chip>
            </li>
            <li data-idea-chip="type">
              <span class="visually-hidden">{{ 'ideas.chip.type' | transloco }}</span>
              <ui-chip variant="plain">
                @if (story.idea.type; as type) {
                  <span class="chip-body"><ui-type-glyph [type]="type" [size]="14" [decorative]="true" />{{ 'types.' + type | transloco }}</span>
                } @else {
                  <span class="unset">{{ 'ideas.noType' | transloco }}</span>
                }
              </ui-chip>
            </li>
            <li data-idea-chip="feature">
              <span class="visually-hidden">{{ 'ideas.chip.feature' | transloco }}</span>
              @if (story.idea.feature; as feature) {
                <ui-chip variant="mono" tone="primary">{{ feature }}</ui-chip>
              } @else {
                <ui-chip variant="plain"><span class="unset">{{ 'ideas.noFeature' | transloco }}</span></ui-chip>
              }
            </li>
            <li data-idea-chip="milestone">
              <span class="visually-hidden">{{ 'ideas.chip.milestone' | transloco }}</span>
              <ui-chip variant="plain">
                @if (story.idea.milestone; as milestone) {
                  <span class="chip-body"><ui-icon name="flag" [size]="12" />{{ milestone }}</span>
                } @else {
                  <span class="unset">{{ 'ideas.noMilestone' | transloco }}</span>
                }
              </ui-chip>
            </li>
            <li data-idea-chip="priority"><ui-priority [value]="story.idea.priority" /></li>
            @if (story.source?.kind === 'worktree') {
              <!-- Spec 039 (ISC-209): the story was read from a spec worktree's copy, not the main checkout's. -->
              <li data-idea-chip="source"><ui-source-chip [source]="story.source" /></li>
            }
          </ul>
        </div>
        <div class="sh-row">
          <div class="sh-main">
            <h1 id="idea" tabindex="-1">{{ story.idea.slug }}</h1>
            <p class="hint source" data-idea-source>{{ 'ideas.source' | transloco: { path: story.idea.path, hash: shortHash() } }}</p>
          </div>
          <div class="sh-actions">
            <!-- Spec 026 (T28, ISC-171): the idea's relations (feature and milestone parents) in the detail sidebar. -->
            <a
              ui-button
              data-show-relations
              [routerLink]="[]"
              [queryParams]="{ sel: ref() }"
              queryParamsHandling="merge"
              [replaceUrl]="true"
              [attr.data-ref]="ref()"
              [attr.data-selected]="look()"
            >
              <ui-icon name="panel-right-open" [size]="16" />{{ 'ideas.showRelations' | transloco }}
            </a>
            <code class="cmd" data-idea-command>{{ command() }}</code>
          </div>
        </div>
      </div>

      <div class="layout">
        <div class="col">
          @if (story.idea.title) {
            <figure class="idea-quote" data-idea-goal>
              <figcaption class="eyebrow">{{ 'ideas.quote' | transloco }} · <code>{{ story.idea.path }}</code></figcaption>
              <blockquote>{{ story.idea.title }}</blockquote>
            </figure>
          }
          <ui-card class="next-step" data-idea-next>
            <p class="eyebrow">{{ 'ideas.next.title' | transloco }}</p>
            <div><code class="cmd">{{ command() }}</code></div>
            <ul class="why">
              <li>{{ 'ideas.next.why' | transloco }}</li>
            </ul>
          </ui-card>
          <ui-card class="prose-card" [padding]="24">
            <ui-doc-prose [page]="prosePage() ?? story.page" [wide]="false" />
            <p class="hint ro-hint" data-idea-hint><ui-icon name="lock" [size]="12" />{{ 'ideas.allocateHint' | transloco }}</p>
          </ui-card>
        </div>

        @if (state.tier() === 'wide') {
          <aside class="toc-col" [attr.aria-label]="'ideas.contents' | transloco">
            @if (story.page.toc.length > 0) {
              <nav class="docs-toc" [attr.aria-label]="'docs.contents' | transloco">
                <p class="eyebrow rail-eyebrow"><span>{{ 'ideas.contents' | transloco }}</span><span>{{ story.page.toc.length }}</span></p>
                <ol class="toc-list">
                  @for (entry of story.page.toc; track entry.anchor) {
                    <li [attr.data-level]="entry.level">
                      <a [href]="'#' + entry.anchor" [attr.aria-current]="active() === entry.anchor ? 'true' : null" (click)="jump($event, entry.anchor)">{{ entry.text }}</a>
                    </li>
                  }
                </ol>
              </nav>
            }
            <section data-idea-record>
              <p class="eyebrow">{{ 'ideas.record.title' | transloco }}</p>
              <ul class="shape-rec">
                <li>{{ 'ideas.record.slug' | transloco }} <span class="mono">{{ story.idea.slug }}</span></li>
                <li>
                  {{ 'ideas.record.shape' | transloco }}
                  @if (story.idea.type; as type) {
                    {{ 'types.' + type | transloco }}
                  } @else {
                    {{ 'ideas.record.noShape' | transloco }}
                  }
                </li>
                <li>{{ 'ideas.record.hash' | transloco }} <span class="mono">{{ shortHash() }}</span></li>
              </ul>
            </section>
          </aside>
        }
      </div>
    } @else if (failed()) {
      <ui-notice tone="error" data-idea-error>{{ 'ideas.error' | transloco }}</ui-notice>
    } @else {
      <div class="loading" role="status" [attr.aria-label]="'ideas.loading' | transloco">
        <ui-skeleton width="40%" height="28px" />
        <ui-skeleton height="16px" />
        <ui-skeleton height="16px" />
        <ui-skeleton width="70%" height="16px" />
      </div>
    }
  `,
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
  /** The shaping command the Next step card names (prototype `next-step`). */
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
    addEventListener('scroll', onScroll, { passive: true, capture: true });
    inject(DestroyRef).onDestroy(() => removeEventListener('scroll', onScroll, { capture: true }));
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
