/**
 * The shared look of the board's rail blocks (This frame, Needs you, Your steps): a card surface at wide, bare rows
 * in the bottom sheet. Tokens only; rows keep a 40 px (rail) or 44 px (coarse pointer) target.
 */
export const RAIL_BLOCK_STYLES = `
  :host { display: block; min-inline-size: 0; }
  .block { display: grid; gap: 8px; min-inline-size: 0; padding: 12px 16px; border: 1px solid var(--line); border-radius: var(--radius-box); background: var(--color-base-100); }
  .head { display: flex; gap: 8px; align-items: center; margin: 0; font-size: 14px; font-weight: 600; line-height: 20px; }
  .title { font-size: 14px; font-weight: 600; line-height: 20px; }
  .rows { display: grid; gap: 4px; margin: 0; padding: 0; list-style: none; }
  .row { display: flex; gap: 8px; align-items: center; inline-size: 100%; min-block-size: 40px; padding: 4px 8px; border: 0; border-radius: var(--radius-field); background: none; color: var(--color-base-content); text-align: start; cursor: pointer; transition: background-color var(--motion-duration-fast) var(--motion-ease-standard); }
  .row:hover { background: var(--color-base-200); }
  .mono { font-family: var(--font-mono); font-size: 13px; font-weight: 600; }
  .text { flex: 1; min-inline-size: 0; overflow: hidden; font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
  .empty, .source { margin: 0; color: var(--muted-ink); font-size: 13px; line-height: 20px; }
  .agents { display: flex; flex-wrap: wrap; gap: 4px 8px; align-items: center; margin-block-end: 4px; }
  .agents .source { flex-basis: 100%; }
  @media (pointer: coarse) { .row { min-block-size: 44px; } }
`;
