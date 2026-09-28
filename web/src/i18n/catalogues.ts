import type { Translation } from '@jsverse/transloco';
import de from './de.json';
import en from './en.json';

/**
 * The two catalogues, bundled into the build as JSON modules: the app never fetches `/assets/i18n/*.json` at runtime,
 * so no request leaves the page for a translation (ISC-2). `web/tests/i18n-parity.test.ts` holds them in parity
 * (ISC-22).
 */
export const LANGS = ['en', 'de'] as const;
export type Lang = (typeof LANGS)[number];

export const CATALOGUES: Record<Lang, Translation> = { en, de };

export const isLang = (value: string): value is Lang => (LANGS as readonly string[]).includes(value);
