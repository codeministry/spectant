import { dateTimeFormat, formatClock, formatDate, formatDay, formatDayMonth, formatInstant, formatMonth, localDayKey, type TimeForm } from './format';

/** Intl may put a narrow no-break space before the day period; compare on plain spaces. */
const plain = (text: string): string => text.replace(/[\u202f\u00a0]/g, ' ');

/** 14:05 on 1 October 2026 in the zone the tests run in, as the ISO instant the API would send. */
const LOCAL_AFTERNOON = new Date(2026, 9, 1, 14, 5).toISOString();

describe('shared/time format', () => {
  it('formats an instant as short numeric date and time per app language', () => {
    expect(plain(formatInstant(LOCAL_AFTERNOON, 'de'))).toBe('01.10.2026, 14:05');
    expect(plain(formatInstant(LOCAL_AFTERNOON, 'en'))).toBe('10/01/2026, 2:05 PM');
  });

  it('formats the local date of an instant alone', () => {
    expect(formatDate(LOCAL_AFTERNOON, 'de')).toBe('01.10.2026');
    expect(formatDate(LOCAL_AFTERNOON, 'en')).toBe('10/01/2026');
  });

  it('formats the clock time of an instant alone', () => {
    expect(plain(formatClock(LOCAL_AFTERNOON, 'de'))).toBe('14:05');
    expect(plain(formatClock(LOCAL_AFTERNOON, 'en'))).toBe('2:05 PM');
  });

  it('keeps one hour form per language: German two-digit, English as the clock writes it (ISC-114.1)', () => {
    const morning = new Date(2026, 9, 1, 9, 5).toISOString();
    expect(plain(formatInstant(morning, 'de'))).toBe('01.10.2026, 09:05');
    expect(plain(formatClock(morning, 'de'))).toBe('09:05');
    expect(plain(formatInstant(morning, 'en'))).toBe('10/01/2026, 9:05 AM');
    expect(plain(formatClock(morning, 'en'))).toBe('9:05 AM');
  });

  it('sets no time zone on any format object, so the browser default applies', () => {
    const browserZone = new Intl.DateTimeFormat().resolvedOptions().timeZone;
    const forms: readonly TimeForm[] = ['instant', 'date', 'clock'];
    // `day` is the exception: a calendar day is read as a UTC day so no zone can shift it (ISC-114.3).
    for (const lang of ['de', 'en'] as const) {
      for (const form of forms) {
        expect(dateTimeFormat(lang, form).resolvedOptions().timeZone).toBe(browserZone);
      }
    }
  });

  it('reads a calendar day as that day in the short date form, whatever the zone (ISC-114.3)', () => {
    expect(formatDay('2026-03-15', 'de')).toBe('15.03.2026');
    expect(formatDay('2026-03-15', 'en')).toBe('03/15/2026');
    expect(dateTimeFormat('en', 'day').resolvedOptions().timeZone).toBe('UTC');
  });

  it('builds each format object once per language and form', () => {
    expect(dateTimeFormat('de', 'instant')).toBe(dateTimeFormat('de', 'instant'));
    expect(dateTimeFormat('de', 'instant')).not.toBe(dateTimeFormat('en', 'instant'));
    expect(dateTimeFormat('de', 'instant')).not.toBe(dateTimeFormat('de', 'clock'));
  });

  it('names an axis month and a day without its year per language, as that day in every zone (spec 038)', () => {
    expect([formatMonth('2026-10', 'en'), formatMonth('2026-10', 'de'), formatMonth('2027-03', 'de')]).toEqual(['Oct', 'Okt', 'Mär']);
    expect([formatDayMonth('2026-03-20', 'en'), formatDayMonth('2026-03-20', 'de')]).toEqual(['Mar 20', '20. März']);
    expect([formatMonth('not', 'en'), formatDayMonth('not', 'de')]).toEqual(['not', 'not']);
  });

  it('returns an unparseable value unchanged instead of throwing', () => {
    expect(formatInstant('not a date', 'de')).toBe('not a date');
  });

  it('keys a moment shortly before midnight UTC by its local day', () => {
    const lateUtc = new Date('2026-10-01T23:30:00Z');
    // en-CA renders YYYY-MM-DD; with no zone set it is the local day, an oracle independent of the getters.
    const localDay = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(lateUtc);
    expect(localDayKey(lateUtc)).toBe(localDay);
    expect(localDayKey(new Date(2026, 0, 5, 0, 10))).toBe('2026-01-05');
    expect(localDayKey(new Date(2026, 11, 31, 23, 50))).toBe('2026-12-31');
  });
});
