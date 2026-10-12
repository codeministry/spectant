import { ChangeDetectionStrategy, Component, computed, inject, resource } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import type { IdeaPage as IdeaPageBody } from '../../../../../server/src/spec-routes.contract';
import { ApiClient, type ApiResult } from '../../core/api.service';
import { NotFound } from '../../layout/not-found/not-found';
import { ShellData } from '../../layout/shell/shell-data.service';
import { ShellState } from '../../layout/shell/shell-state.service';
import { UiCard, UiChip, UiDocProse, UiNotice, UiPriority, UiSkeleton, UiTypeGlyph } from '../../shared/ui';
import { UiPageHead } from '../../shared/ui/page-head/page-head';

/**
 * A story of `specs/ideas/` at `/w/:ws/ideas/:slug` (spec 008, T131, ISC-124.2), read-only: the frontmatter as chips
 * (type, feature, milestone, priority, the stage `idea`), the title as the heading, the body through the Docs tab's
 * renderer `ui-doc-prose`, and the file path with the hash's first 8 hex as a muted technical hint. The page offers no
 * write control; allocation happens on the board. A slug the planning tree does not list, an unknown workspace or a
 * 404 of the story route renders the not-found page (ISC-71); unknown while the tree loads, so nothing flashes.
 */
@Component({
  selector: 'app-idea-page',
  imports: [NotFound, TranslocoPipe, UiCard, UiChip, UiDocProse, UiNotice, UiPageHead, UiPriority, UiSkeleton, UiTypeGlyph],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-page': 'idea' },
  styles: `
    :host { display: block; }
    header { display: grid; gap: 8px; margin-block-end: 24px; }
    header ui-page-head { margin-block-start: 8px; }
    h1 { margin: 0; overflow-wrap: anywhere; }
    .chips { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 0; padding: 0; list-style: none; }
    .chips li { display: inline-flex; }
    .chip-body { display: inline-flex; gap: 6px; align-items: center; }
    .mono { font-family: var(--font-mono); }
    .unset { color: var(--muted-ink); }
    .hint { margin: 0; color: var(--muted-ink); font-size: 13px; line-height: 20px; overflow-wrap: anywhere; }
    .source { font-family: var(--font-mono); font-size: 12px; font-variant-numeric: tabular-nums; }
    .loading { display: grid; gap: 8px; max-inline-size: 72ch; }
    .visually-hidden { position: absolute; inline-size: 1px; block-size: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  `,
  template: `
    @if (missing()) {
      <app-not-found />
    } @else if (story(); as story) {
      <ui-card [padding]="24">
        <header>
          <ul class="chips" data-idea-chips [attr.aria-label]="'ideas.meta' | transloco">
            <li data-idea-chip="stage">
              <span class="visually-hidden">{{ 'ideas.chip.stage' | transloco }}</span>
              <ui-chip tone="primary" [dot]="true">{{ 'stages.idea' | transloco }}</ui-chip>
            </li>
            <li data-idea-chip="type">
              <span class="visually-hidden">{{ 'ideas.chip.type' | transloco }}</span>
              <ui-chip>
                @if (story.idea.type; as type) {
                  <span class="chip-body"><ui-type-glyph [type]="type" [size]="14" [decorative]="true" />{{ 'types.' + type | transloco }}</span>
                } @else {
                  <span class="unset">{{ 'ideas.noType' | transloco }}</span>
                }
              </ui-chip>
            </li>
            <li data-idea-chip="feature">
              <span class="visually-hidden">{{ 'ideas.chip.feature' | transloco }}</span>
              <ui-chip>
                @if (story.idea.feature; as feature) {
                  <span class="mono">{{ feature }}</span>
                } @else {
                  <span class="unset">{{ 'ideas.noFeature' | transloco }}</span>
                }
              </ui-chip>
            </li>
            <li data-idea-chip="milestone">
              <span class="visually-hidden">{{ 'ideas.chip.milestone' | transloco }}</span>
              <ui-chip>
                @if (story.idea.milestone; as milestone) {
                  {{ milestone }}
                } @else {
                  <span class="unset">{{ 'ideas.noMilestone' | transloco }}</span>
                }
              </ui-chip>
            </li>
            <li data-idea-chip="priority"><ui-priority [value]="story.idea.priority" /></li>
          </ul>
          <!-- Chips, 16 px, then the page head (ISC-140): the eyebrow 4 px over the idea's title. -->
          <ui-page-head [segments]="[state.ws() ?? '', ('shell.pages.board' | transloco), ('ideas.title' | transloco)]">
            <h1 class="type-page-title" id="idea" tabindex="-1">{{ story.idea.title || story.idea.slug }}</h1>
          </ui-page-head>
          <p class="hint source" data-idea-source>{{ 'ideas.source' | transloco: { path: story.idea.path, hash: shortHash() } }}</p>
        </header>
        <ui-doc-prose [page]="story.page" [wide]="state.tier() === 'wide'" />
        <p class="hint" data-idea-hint>{{ 'ideas.allocateHint' | transloco }}</p>
      </ui-card>
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

  protected readonly slug = computed(() => this.state.route().ideaSlug ?? '');

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
}
