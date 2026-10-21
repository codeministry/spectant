import { DOCUMENT, inject, type Signal } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { LanguageService } from '../../core/language.service';
import type { PaletteEntry, PaletteSource } from '../../core/palette-sources';
import { writeClipboard } from '../../shared/ui/command-chip/command-chip';
import { ToastService } from '../../shared/ui/toast/toast';

/** A group of the palette: its label is `palette.groups.<id>`. */
export const source = (id: string, order: number, entries: Signal<readonly PaletteEntry[]>): PaletteSource => ({
  id,
  labelKey: `palette.groups.${id}`,
  order,
  entries,
});

/** A translate that re-runs when the language changes (the computed reads `LanguageService.current`). */
export function translator(): (key: string, params?: Record<string, unknown>) => string {
  const transloco = inject(TranslocoService);
  const language = inject(LanguageService);
  return (key, params) => {
    language.current();
    return transloco.translate(key, params);
  };
}

/** Copies `command` and says so in the toast (the same words as the command chip). */
export function copier(): (command: string) => void {
  const doc = inject(DOCUMENT);
  const toast = inject(ToastService);
  const transloco = inject(TranslocoService);
  return (command) => {
    void writeClipboard(command, doc).then((done) => {
      toast.show(transloco.translate(done ? 'common.copied' : 'common.copyFallback', { command }));
    });
  };
}
