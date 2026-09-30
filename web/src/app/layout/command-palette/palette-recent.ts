import { DOCUMENT, inject, Injectable, signal } from '@angular/core';
import type { PaletteEntry } from '../../core/palette-sources';

const KEY = 'spectant.palette.recent';
const LIMIT = 5;

const isEntry = (value: unknown): value is PaletteEntry => {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Partial<Record<keyof PaletteEntry, unknown>>;
  const link = entry.link;
  return (
    typeof entry.id === 'string' &&
    typeof entry.label === 'string' &&
    (typeof link === 'string' || (Array.isArray(link) && link.every((part) => typeof part === 'string'))) &&
    Array.isArray(entry.keywords)
  );
};

/**
 * The palette's Recent group (design.md § Routes and state): the last entries opened from the palette, a per-viewer
 * convenience and the app's only `localStorage` use (web/CLAUDE.md § State). Every access is wrapped: in a private
 * window or a web view the store may be empty or throw, and the group is then simply absent.
 */
@Injectable({ providedIn: 'root' })
export class PaletteRecent {
  private readonly storage = ((): Storage | null => {
    try {
      return inject(DOCUMENT).defaultView?.localStorage ?? null;
    } catch {
      return null;
    }
  })();

  readonly entries = signal<readonly PaletteEntry[]>(this.read());

  /** Puts a navigating entry first; commands (copy, theme …) are never remembered. */
  remember(entry: PaletteEntry): void {
    const { id, label, meta, chip, link, keywords } = entry;
    const kept: PaletteEntry = { id, label, meta, chip, link, keywords };
    const next = [kept, ...this.entries().filter((item) => item.id !== id)].slice(0, LIMIT);
    this.entries.set(next);
    try {
      this.storage?.setItem(KEY, JSON.stringify(next));
    } catch {
      // A full or blocked store only loses the convenience.
    }
  }

  private read(): readonly PaletteEntry[] {
    try {
      const parsed: unknown = JSON.parse(this.storage?.getItem(KEY) ?? '[]');
      return Array.isArray(parsed) ? parsed.filter(isEntry).slice(0, LIMIT) : [];
    } catch {
      return [];
    }
  }
}
