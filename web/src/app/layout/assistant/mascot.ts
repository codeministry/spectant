import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export type MascotState = 'idle' | 'thinking' | 'happy';

/**
 * The assistant's mascot: the ring lime into cyan, top left to bottom
 * right, and the violet dot with eyes and mouth in its gap. Not a lucide icon (`data-icon-exempt`, ISC-18.2); the ring
 * is eight dashed arcs mixing lime into cyan instead of a gradient, because fragment ids break under `<base href>` in
 * WebKit. `thinking` spins the ring and bobs the dot, never under reduced motion.
 */
@Component({
  selector: 'app-mascot',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[style.--m-size.px]': 'size()', '[attr.data-state]': 'state()' },
  templateUrl: './mascot.html',
  styleUrl: './mascot.css',
})
export class Mascot {
  readonly size = input(20);
  readonly state = input<MascotState>('idle');

  /** The eight arcs of the ring and how much lime each holds (lime top left, cyan bottom right). */
  protected readonly arcs = [
    { offset: 0, mix: '4%' },
    { offset: -1, mix: '4%' },
    { offset: -2, mix: '31%' },
    { offset: -3, mix: '69%' },
    { offset: -4, mix: '96%' },
    { offset: -5, mix: '96%' },
    { offset: -6, mix: '69%' },
    { offset: -7, mix: '31%' },
  ] as const;
}
