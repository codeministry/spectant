import type { Lang } from '../../../i18n/catalogues';

/**
 * The app's one date and time formatter (spec 006). Instants render in the browser's time zone: no instant form
 * sets `timeZone`, so the Intl default applies; only `day` reads its calendar day in UTC. Options follow spec.md
 * § Constraints; no hand-built patterns.
 */

/** The forms a value can take; `day` is a calendar day, read as a UTC day so no zone can shift it. */
export type TimeForm = 'instant' | 'date' | 'clock' | 'clockSeconds' | 'day';

/** App language to Intl locale; `en-US` gives `10/01/2026, 2:05 PM`. */
const LOCALE: Readonly<Record<Lang, string>> = { de: 'de-DE', en: 'en-US' };

const DATE_PART: Intl.DateTimeFormatOptions = { day: '2-digit', month: '2-digit', year: 'numeric' };

/** German writes the hour with two digits, as its short clock does (`09:05`); English as its clock does (`9:05 AM`). */
const HOUR: Readonly<Record<Lang, Intl.DateTimeFormatOptions['hour']>> = { de: '2-digit', en: 'numeric' };

const OPTIONS: Readonly<Record<TimeForm, (lang: Lang) => Intl.DateTimeFormatOptions>> = {
  instant: (lang) => ({ ...DATE_PART, hour: HOUR[lang], minute: '2-digit' }),
  date: () => DATE_PART,
  clock: () => ({ timeStyle: 'short' }),
  // A step timeline (spec 015): red to green often lies within a minute, so the seconds show, on a 24-hour clock.
  clockSeconds: () => ({ hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }),
  day: () => ({ ...DATE_PART, timeZone: 'UTC' }),
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

/** The clock time of an instant with its seconds, 24-hour in both languages: `14:32:05` (spec 015, a step timeline). */
export function formatClockSeconds(iso: string, lang: Lang): string {
  return formatIso(iso, lang, 'clockSeconds');
}

type DeltaUnit = 'hour' | 'minute' | 'second';

/**
 * The parts of a span at the precision its size needs (spec 015): seconds under 1 min, minutes and seconds under
 * 10 min, whole minutes under 1 h, hours and minutes above; a zero part after the first drops, a negative span is 0 s.
 */
function deltaParts(ms: number): ReadonlyArray<readonly [number, DeltaUnit]> {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  const parts: Array<readonly [number, DeltaUnit]> =
    seconds < 60
      ? [[seconds, 'second']]
      : minutes < 10
        ? [[minutes, 'minute'], [seconds % 60, 'second']]
        : minutes < 60
          ? [[minutes, 'minute']]
          : [[Math.floor(minutes / 60), 'hour'], [minutes % 60, 'minute']];
  return parts.filter(([value], i) => i === 0 || value > 0);
}

const DELTA_SHORT: Readonly<Record<DeltaUnit, string>> = { hour: 'h', minute: 'min', second: 's' };

/** The time since the previous step, the same in both languages: `+45 s`, `+2 min 5 s`, `+12 min`, `+1 h 12 min`. */
export function formatStepDelta(ms: number): string {
  return `+${deltaParts(ms)
    .map(([value, unit]) => `${value} ${DELTA_SHORT[unit]}`)
    .join(' ')}`;
}

const unitCache = new Map<string, Intl.NumberFormat>();

/** The same span spelled out for a screen reader in the app language: `2 minutes 5 seconds` / `2 Minuten 5 Sekunden`. */
export function formatStepDeltaLong(ms: number, lang: Lang): string {
  return deltaParts(ms)
    .map(([value, unit]) => {
      const key = `${lang}:${unit}`;
      let format = unitCache.get(key);
      if (!format) {
        format = new Intl.NumberFormat(LOCALE[lang], { style: 'unit', unit, unitDisplay: 'long' });
        unitCache.set(key, format);
      }
      return format.format(value);
    })
    .join(' ');
}

/** A calendar day (`YYYY-MM-DD`, a milestone target) as that same day in every zone: `15.03.2026` / `03/15/2026`. */
export function formatDay(isoDate: string, lang: Lang): string {
  return formatIso(isoDate, lang, 'day');
}

/** `YYYY-MM-DD` of the local (browser) day a moment falls on, for grouping by day and the local today. */
export function localDayKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** The axis forms of a calendar month and of a day within its year (spec 038, the Gantt lens), read in UTC as `day` is. */
const AXIS_OPTIONS = {
  month: { month: 'short', timeZone: 'UTC' },
  dayMonth: { day: 'numeric', month: 'short', timeZone: 'UTC' },
} as const satisfies Readonly<Record<string, Intl.DateTimeFormatOptions>>;
const axisCache = new Map<string, Intl.DateTimeFormat>();

function axisFormat(lang: Lang, form: keyof typeof AXIS_OPTIONS): Intl.DateTimeFormat {
  const key = `${lang}:${form}`;
  let format = axisCache.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat(LOCALE[lang], AXIS_OPTIONS[form]);
    axisCache.set(key, format);
  }
  return format;
}

/** A month (`YYYY-MM`) as its short name, without the abbreviation dot German adds: `Mar` / `März`, `Oct` / `Okt`. */
export function formatMonth(isoMonth: string, lang: Lang): string {
  // Date.parse is lenient (`not-01` parses), so the shape is checked first.
  const epoch = /^\d{4}-\d{2}$/u.test(isoMonth) ? Date.parse(`${isoMonth}-01`) : Number.NaN;
  return Number.isNaN(epoch) ? isoMonth : axisFormat(lang, 'month').format(epoch).replace(/\.$/u, '');
}

/** A calendar day (`YYYY-MM-DD`) without its year, as that day in every zone: `Mar 20` / `20. März`. */
export function formatDayMonth(isoDate: string, lang: Lang): string {
  const epoch = Date.parse(isoDate);
  return Number.isNaN(epoch) ? isoDate : axisFormat(lang, 'dayMonth').format(epoch);
}
