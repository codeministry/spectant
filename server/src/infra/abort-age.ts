/**
 * The run lock's abort age as an optional input field (spec 040, ISC-225): `{abortAfterMs}` when the age is known (the
 * `runAbortMinutes` setting × 60 000), `{}` when it is not, so core's default applies. Every write input, every item
 * state clock and every route that passes the age on spreads this one field.
 */
export function abortAge(abortAfterMs: number | undefined): { abortAfterMs?: number } {
  return abortAfterMs === undefined ? {} : { abortAfterMs };
}
