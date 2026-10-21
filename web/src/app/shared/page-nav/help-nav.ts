import { DOCUMENT } from '@angular/common';
import { afterNextRender, ChangeDetectionStrategy, Component, DestroyRef, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';

/** One section of the page: its id (the nav chip's fragment), its heading's id and its nav label key. */
export interface HelpSection {
  readonly id: string;
  readonly heading: string;
  readonly label: string;
}

/**
 * The band a section must cross to count as the one in view: below the 64 px header and the nav's own row, and in the
 * upper part of the viewport, so the current chip changes as a heading reaches the top rather than the bottom.
 */
const BAND = '-128px 0px -60% 0px';

/**
 * The Help page's section nav (spec 008, T162, ISC-133.1): one chip per section, each a same-page link to the section
 * id (`?ws=` kept), sticky under the shell header. `aria-current="true"` follows the section in view through an
 * IntersectionObserver: the first section in page order that is inside the band, else the last one that was. A chip
 * moves focus to its section heading, as a `g` section jump does (web/CLAUDE.md § Accessibility).
 */
@Component({
  selector: 'app-help-nav',
  imports: [RouterLink, TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './help-nav.html',
  styleUrl: './help-nav.css',
})
export class HelpNav {
  readonly sections = input.required<readonly HelpSection[]>();

  private readonly document = inject(DOCUMENT);
  private readonly inBand = new Set<string>();
  protected readonly current = signal<string | null>(null);

  constructor() {
    let observer: IntersectionObserver | null = null;
    inject(DestroyRef).onDestroy(() => observer?.disconnect());
    afterNextRender(() => {
      const sections = this.sections();
      this.current.set(sections[0]?.id ?? null);
      // No observer (an old web view, the unit DOM): the first chip stays current and every link still works.
      if (typeof IntersectionObserver === 'undefined') return;
      observer = new IntersectionObserver((entries) => this.update(entries), { rootMargin: BAND });
      for (const section of sections) {
        const element = this.document.getElementById(section.id);
        if (element) observer.observe(element);
      }
    });
  }

  /** Scrolls to the section and focuses its heading; the router link then writes the fragment. */
  protected go(section: HelpSection): void {
    const target = this.document.getElementById(section.id);
    const heading = this.document.getElementById(section.heading);
    target?.scrollIntoView({ block: 'start' });
    if (heading) {
      if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
      heading.focus({ preventScroll: true });
    }
    this.current.set(section.id);
  }

  private update(entries: readonly IntersectionObserverEntry[]): void {
    for (const entry of entries) {
      const id = entry.target.id;
      if (entry.isIntersecting) this.inBand.add(id);
      else this.inBand.delete(id);
    }
    const first = this.sections().find((section) => this.inBand.has(section.id));
    if (first) this.current.set(first.id);
  }
}
