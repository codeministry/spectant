let next = 0;

/** A document-unique id for ARIA wiring (`aria-controls`, `aria-labelledby`) and CSS anchor names. */
export const nextId = (prefix: string): string => `${prefix}-${String(++next)}`;
