// The narrow readers of an untyped API body (`DashboardBody` and the other bodies web types as `unknown`): the shell's
// rows (shell-data.service.ts) and the palette's index (command-palette/palette-index.ts) assume nothing else of it.

/** A JSON object, read field by field. */
export type Loose = Readonly<Record<string, unknown>>;

export const isLoose = (value: unknown): value is Loose => typeof value === 'object' && value !== null;

/** `value` when it is a string, else null. */
export const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);

/** A finite number as served, 0 otherwise (a count the body may lack). */
export const count = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
