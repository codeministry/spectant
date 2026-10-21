import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { ICONS, type IconName } from './icons';

/**
 * A Lucide icon from the pinned `lucide-static` version (ISC-18.2), drawn inline so it takes `currentColor`.
 * Decorative by default (`aria-hidden`); pass `label` (a translated string) when the icon alone carries meaning,
 * which makes it `role="img"` with that accessible name. The host carries the drawn name as `data-icon`, so a test can
 * name the icon at a place without reading path data (ISC-147.1).
 */
@Component({
  // The design system's shared primitives carry the `ui-` prefix (design.md § Components), not the app's `app-`.
  selector: 'ui-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-icon]': 'name()' },
  styleUrl: './icon.css',
  templateUrl: './icon.html',
})
export class UiIcon {
  readonly name = input.required<IconName>();
  readonly size = input(16);
  readonly label = input<string>();

  private readonly sanitizer = inject(DomSanitizer);

  // Trusting the markup is safe here and only here: `ICONS` is a committed constant generated at build time from the
  // pinned `lucide-static` package (generate-icons.ts keeps only plain shape elements), and `name` is typed to its
  // keys, so no runtime or user input reaches innerHTML. Angular's sanitiser would otherwise strip the SVG shapes.
  protected readonly markup = computed(() => this.sanitizer.bypassSecurityTrustHtml(ICONS[this.name()]));
}
