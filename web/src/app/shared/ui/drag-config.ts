import type { DragDropConfig } from '@angular/cdk/drag-drop';

/**
 * The one drag configuration of the workspace board (spec 008, T125, ISC-130; design 008 § Drag, Drop und die
 * Alternativen; plan DS-APP-23): a touch lifts a card after a 350 ms press, so a swipe keeps scrolling; a mouse lifts it
 * at once. Sorting is off everywhere: a card's place in its column comes from the files, so a drop never reorders.
 */
export const BOARD_DRAG_DELAY = { touch: 350, mouse: 0 } as const;

export const BOARD_DRAG_CONFIG: DragDropConfig = {
  dragStartDelay: BOARD_DRAG_DELAY,
  // Spec 026 (T26, ISC-171): the card lifts only after 4 px of movement, so a click selects and a drag still moves.
  dragStartThreshold: 4,
  sortingDisabled: true,
};
