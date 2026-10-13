import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export type MascotState = 'idle' | 'thinking' | 'happy';

/**
 * The assistant's mascot (prototype `assistant.js` `mascot(state, size)`): the ring lime into cyan, top left to bottom
 * right, and the violet dot with eyes and mouth in its gap. Not a lucide icon (`data-icon-exempt`, ISC-18.2); the ring
 * is eight dashed arcs mixing lime into cyan instead of a gradient, because fragment ids break under `<base href>` in
 * WebKit. `thinking` spins the ring and bobs the dot, never under reduced motion.
 */
@Component({
  selector: 'app-mascot',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[style.--m-size.px]': 'size()', '[attr.data-state]': 'state()' },
  template: `
    <svg class="mascot" viewBox="0 0 48 48" aria-hidden="true" focusable="false" data-icon-exempt>
      <g class="m-rings">
        @for (arc of arcs; track arc.offset) {
          <circle class="m-ring" cx="24" cy="24" r="15" pathLength="8" [attr.stroke-dashoffset]="arc.offset" [style.--m-mix]="arc.mix" />
        }
      </g>
      <g class="m-face">
        <circle class="m-dot" cx="31.5" cy="11" r="7.5" />
        <circle class="m-eye" cx="29.3" cy="10" r="1.15" />
        <circle class="m-eye" cx="33.7" cy="10" r="1.15" />
        <path class="m-mouth" d="M29.5 13.4c.9 1.2 3.1 1.2 4 0" />
      </g>
    </svg>
  `,
  styles: `
    :host {
      display: inline-grid;
      place-items: center;
      inline-size: var(--m-size);
      block-size: var(--m-size);
    }

    /* The prototype's mascot keeps its own colours in both themes (#a6e22e, #78dce8, #ab9df2, #221f22). */
    .mascot {
      --m-lime: oklch(84.1% 0.2044 127.3);
      --m-cyan: oklch(83.8% 0.095 205.7);
      --m-violet: oklch(74.1% 0.121 290.7);
      --m-ink: oklch(24.4% 0.007 325.8);

      inline-size: 100%;
      block-size: 100%;
      overflow: visible;
    }

    .m-rings {
      transform: rotate(-17deg);
      transform-origin: 24px 24px;
    }

    .m-ring {
      fill: none;
      stroke: color-mix(in oklch, var(--m-lime) var(--m-mix), var(--m-cyan));
      stroke-dasharray: 1.04 6.96;
      stroke-width: 5;
    }

    .m-dot {
      fill: var(--m-violet);
    }

    .m-eye {
      fill: var(--m-ink);
    }

    .m-mouth {
      fill: none;
      stroke: var(--m-ink);
      stroke-linecap: round;
      stroke-width: 1.2;
    }

    :host([data-state="happy"]) .m-mouth {
      transform: translateY(0.4px) scale(1.3);
      transform-origin: 31.5px 14px;
    }

    @media (prefers-reduced-motion: no-preference) {
      :host([data-state="thinking"]) .m-rings {
        animation: m-spin calc(var(--dur-tint) * 1.5) linear infinite;
      }

      :host([data-state="thinking"]) .m-face {
        animation: m-bob var(--dur-tint) ease-in-out infinite;
      }
    }

    @keyframes m-spin {
      to {
        transform: rotate(343deg);
      }
    }

    @keyframes m-bob {
      50% {
        transform: translateY(-1.5px);
      }
    }
  `,
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
