import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import type { SpecType } from '../../../../../../core/src/files';
import { UiIcon } from '../../icons/icon';
import type { IconName } from '../../icons/icons';

/** What a type glyph stands for: a spec type from `spec_type:`, or an idea, which has no spec folder yet. */
export type TypeGlyphKind = SpecType | 'idea';

/**
 * One Lucide icon per type (spec 008, ISC-129). `chore` takes the broom, not a wrench: the task board's builder tag
 * owns the wrench, and two meanings must not share a shape.
 */
export const TYPE_GLYPHS: Readonly<Record<TypeGlyphKind, IconName>> = {
  feature: 'puzzle',
  bug: 'bug',
  refactor: 'refresh-ccw-dot',
  spike: 'flask-conical',
  infra: 'server',
  project: 'folder-kanban',
  chore: 'brush-cleaning',
  idea: 'lightbulb',
};

/**
 * The type glyph of a board card, a dashboard row, the palette and the Features / Milestones chips (DS-APP-26). It
 * draws in `currentColor`, so the consumer's ink decides the tone. By default the icon is an image named by the type
 * word from `types.*`; set `decorative` where the word stands visibly beside it (a filter chip), so it is not read twice.
 */
@Component({
  selector: 'ui-type-glyph',
  imports: [TranslocoPipe, UiIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-type]': 'type()' },
  styles: `
    :host { display: inline-flex; flex: none; line-height: 0; }
  `,
  template: `
    @if (decorative()) {
      <ui-icon [name]="icon()" [size]="size()" />
    } @else {
      <ui-icon [name]="icon()" [size]="size()" [label]="'types.' + type() | transloco" />
    }
  `,
})
export class UiTypeGlyph {
  readonly type = input.required<TypeGlyphKind>();
  /** 16 on cards and rows (the board card's glyph); 14 and 20 match `ui-glyph`'s sizes. */
  readonly size = input<14 | 16 | 20>(16);
  readonly decorative = input(false);

  protected readonly icon = computed(() => TYPE_GLYPHS[this.type()]);
}
