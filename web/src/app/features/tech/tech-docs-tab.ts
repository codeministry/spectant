import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import type { DocsPage, TechModel } from '../../../../../core/src/files';
import { ApiClient } from '../../core/api.service';
import { ShellState } from '../../layout/shell/shell-state.service';
import { UiCommandChip } from '../../shared/ui/command-chip/command-chip';
import { UiDocProse } from '../../shared/ui/doc-prose/doc-prose';
import { UiEmptyState } from '../../shared/ui/empty-state/empty-state';
import { UiNotice } from '../../shared/ui/notice/notice';

/** The two curated tabs that render a page of `specs/tech.md`. */
export type TechDocsPageName = 'overview' | 'architecture';

/** The tech.md section keys each page is made of; a `tech-section` finding about one of them warns on that page. */
const PAGE_SECTIONS: Readonly<Record<TechDocsPageName, readonly string[]>> = {
  overview: ['overview', 'stack'],
  architecture: ['architecture'],
};

/** The command the empty state offers: the Spec skill drafts `specs/tech.md`. */
const DRAFT_COMMAND = '/spec-doc';

/**
 * The Overview and Architecture tabs of the tech page (spec 023, T15, ISC-134.1; design.md § Overview und
 * Architecture): `TechModel.pages[page]` through `ui-doc-prose`, composed like the spec page's Docs tabs (prose straight
 * on the page, no card; the TOC a sticky column at wide, a disclosure above the prose otherwise), images through the
 * workspace's tech asset route. Above the prose, one warning notice per `tech-section` finding about a key of this page
 * (Overview: `overview`, `stack`; Architecture: `architecture`).
 *
 * Without `specs/tech.md` (`pages: null`), and when every key of this page is missing so the tab would be empty
 * (design.md § Overview und Architecture), it renders `ui-empty-state` instead (T22, ISC-134.2): `book-open`,
 * `tech.empty.*` and the `/spec-doc` command chip, whose copy button gets a 44 × 44 hit area. A page that lacks only
 * some of its keys keeps the notices above the prose. `ws` defaults to the route's workspace.
 */
@Component({
  selector: 'app-tech-docs-tab',
  imports: [TranslocoPipe, UiCommandChip, UiDocProse, UiEmptyState, UiNotice],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-tech-tab]': 'page()' },
  styles: `
    :host { display: block; }
    ui-notice { margin-block-end: 16px; }
    ui-empty-state { margin-block-start: 48px; }
    /* The copy button stays chip-sized; an invisible 44 × 44 box centred on it is the hit area (WCAG 2.5.8). */
    ui-command-chip ::ng-deep .copy { position: relative; }
    ui-command-chip ::ng-deep .copy::after { position: absolute; inset-block-start: 50%; inset-inline-start: 50%; inline-size: 44px; block-size: 44px; content: ''; translate: -50% -50%; }
  `,
  template: `
    @if (empty()) {
      <ui-empty-state data-tech-empty icon="book-open" [heading]="'tech.empty.title' | transloco" [body]="'tech.empty.body' | transloco">
        <ui-command-chip
          [command]="command"
          [copyLabel]="'common.copyCommand' | transloco"
          [copiedLabel]="'common.copied' | transloco: { command }"
          [manualHint]="'common.copyFallback' | transloco"
        />
      </ui-empty-state>
    } @else if (doc(); as doc) {
      @for (key of missingKeys(); track key) {
        <ui-notice tone="warning" [attr.data-tech-section]="key">
          <strong>{{ 'tech.section.missing' | transloco: { key } }}</strong>
          {{ 'tech.section.hint' | transloco }}
        </ui-notice>
      }
      <ui-doc-prose [page]="doc" [wide]="state.tier() === 'wide'" [assetUrl]="assetUrl()" />
    }
  `,
})
export class TechDocsTab {
  protected readonly state = inject(ShellState);
  private readonly api = inject(ApiClient);

  readonly page = input.required<TechDocsPageName>();
  readonly model = input.required<TechModel>();
  /** The workspace the asset URLs name; null takes the route's. */
  readonly ws = input<string | null>(null);

  protected readonly doc = computed<DocsPage | null>(() => {
    const pages = this.model().pages;
    return pages === null ? null : pages[this.page()];
  });

  /** The keys of this page that tech.md lacks, in the order core reported them. */
  protected readonly missingKeys = computed<readonly string[]>(() => {
    const keys = PAGE_SECTIONS[this.page()];
    return this.model().diagnostics.flatMap(({ diagnostic }) =>
      diagnostic.code === 'tech-section' && diagnostic.subject !== undefined && keys.includes(diagnostic.subject) ? [diagnostic.subject] : [],
    );
  });

  /** No tech.md, or none of this page's keys in it: the tab would be empty, so it shows the empty state. */
  protected readonly empty = computed(() => {
    const missing = this.missingKeys();
    return this.doc() === null || PAGE_SECTIONS[this.page()].every((key) => missing.includes(key));
  });

  protected readonly command = DRAFT_COMMAND;

  protected readonly assetUrl = computed<((path: string) => string) | null>(() => {
    const ws = this.ws() ?? this.state.ws();
    return ws === null ? null : (path) => this.api.techAssetUrl(ws, path);
  });
}
