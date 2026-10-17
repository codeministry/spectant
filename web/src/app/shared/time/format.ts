import type { Lang } from '../../../i18n/catalogues';

/**
 * The app's one date and time formatter (spec 006). Instants render in the browser's time zone: no format object
 * here sets `timeZone`, so the Intl default applies. Options follow spec.md § Constraints; no hand-built patterns.
 */

/** The forms a value can take. `day` (a calendar day read as a UTC day) slots in here with `formatDay`. */
export type TimeForm = 'instant' | 'date' | 'clock';

/** App language to Intl locale; `en-US` gives `10/01/2026, 2:05 PM`. */
const LOCALE: Readonly<Record<Lang, string>> = { de: 'de-DE', en: 'en-US' };

const DATE_PART: Intl.DateTimeFormatOptions = { day: '2-digit', month: '2-digit', year: 'numeric' };

/** German writes the hour with two digits, as its short clock does (`09:05`); English as its clock does (`9:05 AM`). */
const HOUR: Readonly<Record<Lang, Intl.DateTimeFormatOptions['hour']>> = { de: '2-digit', en: 'numeric' };

const OPTIONS: Readonly<Record<TimeForm, (lang: Lang) => Intl.DateTimeFormatOptions>> = {
  instant: (lang) => ({ ...DATE_PART, hour: HOUR[lang], minute: '2-digit' }),
  date: () => DATE_PART,
  clock: () => ({ timeStyle: 'short' }),
};

const cache = new Map<string, Intl.DateTimeFormat>();

/** The cached format object for one language and form; exported for the unit spec's zone check. */
export function dateTimeFormat(lang: Lang, form: TimeForm): Intl.DateTimeFormat {
  const key = `${lang}:${form}`;
  let format = cache.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat(LOCALE[lang], OPTIONS[form](lang));
    cache.set(key, format);
  }
  return format;
}

/** Formats an ISO value; an unparseable one comes back unchanged rather than throwing. */
function formatIso(iso: string, lang: Lang, form: TimeForm): string {
  const epoch = Date.parse(iso);
  return Number.isNaN(epoch) ? iso : dateTimeFormat(lang, form).format(epoch);
}

/** Date and time of an instant: `01.10.2026, 14:05` / `10/01/2026, 2:05 PM`. */
export function formatInstant(iso: string, lang: Lang): string {
  return formatIso(iso, lang, 'instant');
}

/** The local date of an instant: `01.10.2026` / `10/01/2026`. */
export function formatDate(iso: string, lang: Lang): string {
  return formatIso(iso, lang, 'date');
}

/** The clock time of an instant alone, only under a heading that shows the date: `14:05` / `2:05 PM`. */
export function formatClock(iso: string, lang: Lang): string {
  return formatIso(iso, lang, 'clock');
}

/** `YYYY-MM-DD` of the local (browser) day a moment falls on, for grouping by day and the local today. */
export function localDayKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}
