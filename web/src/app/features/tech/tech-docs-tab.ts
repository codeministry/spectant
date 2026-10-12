import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import type { DocsPage, TechModel } from '../../../../../core/src/files';
import { ApiClient } from '../../core/api.service';
import { ShellState } from '../../layout/shell/shell-state.service';
import { UiDocProse } from '../../shared/ui/doc-prose/doc-prose';
import { UiNotice } from '../../shared/ui/notice/notice';

/** The two curated tabs that render a page of `specs/tech.md`. */
export type TechDocsPageName = 'overview' | 'architecture';

/** The tech.md section keys each page is made of; a `tech-section` finding about one of them warns on that page. */
const PAGE_SECTIONS: Readonly<Record<TechDocsPageName, readonly string[]>> = {
  overview: ['overview', 'stack'],
  architecture: ['architecture'],
};


/**
 * The Overview and Architecture tabs of the tech page (spec 023, T15, ISC-134.1; design.md § Overview und
 * Architecture): `TechModel.pages[page]` through `ui-doc-prose`, composed like the spec page's Docs tabs (prose straight
 * on the page, no card; the TOC a sticky column at wide, a disclosure above the prose otherwise), images through the
 * workspace's tech asset route. Above the prose, one warning notice per `tech-section` finding about a key of this page
 * (Overview: `overview`, `stack`; Architecture: `architecture`).
 *
 * Without `specs/tech.md` (`pages: null`) it renders only the `[data-tech-empty]` seam, which T22 fills with the empty
 * state. `ws` defaults to the route's workspace.
 */
@Component({
  selector: 'app-tech-docs-tab',
  imports: [TranslocoPipe, UiDocProse, UiNotice],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-tech-tab]': 'page()' },
  styles: `
    :host { display: block; }
    ui-notice { margin-block-end: 16px; }
  `,
  template: `
    @if (doc(); as doc) {
      @for (key of missingKeys(); track key) {
        <ui-notice tone="warning" [attr.data-tech-section]="key">
          <strong>{{ 'tech.section.missing' | transloco: { key } }}</strong>
          {{ 'tech.section.hint' | transloco }}
        </ui-notice>
      }
      <ui-doc-prose [page]="doc" [wide]="state.tier() === 'wide'" [assetUrl]="assetUrl()" />
    } @else {
      <!-- T22: the empty state without specs/tech.md replaces this seam. -->
      <div data-tech-empty></div>
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

  protected readonly assetUrl = computed<((path: string) => string) | null>(() => {
    const ws = this.ws() ?? this.state.ws();
    return ws === null ? null : (path) => this.api.techAssetUrl(ws, path);
  });
}
