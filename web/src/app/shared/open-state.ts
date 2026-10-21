import { computed, inject, Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { queryParamSignal, readQueryParam } from './query-param';

// The address schema of every open/collapsed block of spec 021 (ISC-246): one query param `?open=` holding a
// comma-separated list of keys, so a reload and the back button land on the same blocks open. The keys are `specs`
// (the dashboard's full spec list), `tldr` (the TL;DR's further sections), `overlaps` (the spec head's overlaps) and
// `s-<slug>` (one library section). Every other query param (`?density=`, `?steps=`, `?sel=` …) stays its own and is
// never touched here.

/** The query param that holds the open keys. */
export const OPEN_PARAM = 'open';

/** A key of one open block: a fixed block, or a library section by its slug. */
export type OpenKey = 'specs' | 'tldr' | 'overlaps' | `s-${string}`;

const FIXED_KEYS: ReadonlySet<string> = new Set(['specs', 'tldr', 'overlaps']);
/** A section key: `s-` and a slug without whitespace or the list's comma. */
const SECTION_KEY = /^s-[^\s,]+$/u;

export const isOpenKey = (value: string): value is OpenKey => FIXED_KEYS.has(value) || SECTION_KEY.test(value);

/** The key of the library section with `slug`. */
export const sectionKey = (slug: string): OpenKey => `s-${slug}`;

/** The valid keys of `keys`, each once, in their first order. */
const valid = (keys: Iterable<string>): OpenKey[] => [...new Set([...keys].map((key) => key.trim()).filter(isOpenKey))];

/** `?open=`'s value as its keys, in order; unknown, empty and repeated entries are dropped. */
export const parseOpen = (value: string | null | undefined): readonly OpenKey[] => (value ? valid(value.split(',')) : []);

/** The value of `?open=` for `keys`; null when none is valid, so a merge drops the param from the address. */
export function serializeOpen(keys: Iterable<string>): string | null {
  const list = valid(keys);
  return list.length === 0 ? null : list.join(',');
}

/** `value` with `key` opened (appended, unless already open) or closed (removed); the other keys keep their order. */
export function withOpen(value: string | null | undefined, key: OpenKey, open: boolean): string | null {
  const keys = parseOpen(value);
  return serializeOpen(open ? [...keys, key] : keys.filter((entry) => entry !== key));
}

/**
 * `value` with every entry applied at once (`withOpen` per entry, in order): what a block of many keys (a library page's
 * sections) writes in one address change, since separate changes would each read the address before the other landed.
 */
export function withOpenEach(value: string | null | undefined, entries: Iterable<readonly [OpenKey, boolean]>): string | null {
  let next = value ?? null;
  for (const [key, open] of entries) next = withOpen(next, key, open);
  return next;
}

/** The open keys of the current address, and the one way to change them. */
@Injectable({ providedIn: 'root' })
export class OpenState {
  private readonly router = inject(Router);

  private readonly param = queryParamSignal(OPEN_PARAM);

  /** The keys in `?open=`, in order. */
  readonly keys = computed(() => parseOpen(this.param()));

  isOpen(key: OpenKey): boolean {
    return this.keys().includes(key);
  }

  /** Opens or closes `key`: rewrites `?open=` in place, the path, every other param and the fragment kept. */
  set(key: OpenKey, open: boolean): Promise<boolean> {
    return this.navigate(withOpen(this.readParam(), key, open));
  }

  /** Opens and closes several keys in one rewrite of `?open=` (`withOpenEach`). */
  assign(entries: Iterable<readonly [OpenKey, boolean]>): Promise<boolean> {
    return this.navigate(withOpenEach(this.readParam(), entries));
  }

  toggle(key: OpenKey): Promise<boolean> {
    return this.set(key, !this.isOpen(key));
  }

  private navigate(value: string | null): Promise<boolean> {
    return this.router.navigate([], { queryParams: { [OPEN_PARAM]: value }, queryParamsHandling: 'merge', preserveFragment: true, replaceUrl: true });
  }

  private readParam(): string | null {
    return readQueryParam(this.router, OPEN_PARAM);
  }
}
