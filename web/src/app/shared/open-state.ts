import { computed, inject, Injectable } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter, map } from 'rxjs';

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

/** The open keys of the current address, and the one way to change them. */
@Injectable({ providedIn: 'root' })
export class OpenState {
  private readonly router = inject(Router);

  private readonly param = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map(() => this.readParam()),
    ),
    { initialValue: this.readParam() },
  );

  /** The keys in `?open=`, in order. */
  readonly keys = computed(() => parseOpen(this.param()));

  isOpen(key: OpenKey): boolean {
    return this.keys().includes(key);
  }

  /** Opens or closes `key`: rewrites `?open=` in place, the path and every other param kept. */
  set(key: OpenKey, open: boolean): Promise<boolean> {
    const value = withOpen(this.readParam(), key, open);
    return this.router.navigate([], { queryParams: { [OPEN_PARAM]: value }, queryParamsHandling: 'merge', replaceUrl: true });
  }

  toggle(key: OpenKey): Promise<boolean> {
    return this.set(key, !this.isOpen(key));
  }

  private readParam(): string | null {
    return this.router.routerState.snapshot.root.queryParamMap.get(OPEN_PARAM);
  }
}
