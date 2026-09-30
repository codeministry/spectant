import { computed, DOCUMENT, inject, type Provider, type Signal } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { KeyboardService } from '../../core/keyboard.service';
import { LanguageService } from '../../core/language.service';
import { PALETTE_SOURCES, type PaletteEntry, type PaletteSource } from '../../core/palette-sources';
import { SettingsService } from '../../core/settings.service';
import { ThemeService } from '../../core/theme.service';
import { writeClipboard } from '../../shared/ui/command-chip/command-chip';
import { ToastService } from '../../shared/ui/toast/toast';
import { specLink } from '../shell/areas';
import { ShellData } from '../shell/shell-data.service';
import { ShellState } from '../shell/shell-state.service';
import { PaletteIndex } from './palette-index';
import { PaletteRecent } from './palette-recent';

/**
 * An entry that acts instead of navigating (copy a command, switch the theme, open a service): the palette closes and
 * calls `run`. `link` still names the page it concerns. A structural extension of `PaletteEntry`, so the shared seam
 * (`core/palette-sources.ts`) stays as it is.
 */
export interface PaletteCommandEntry extends PaletteEntry {
  readonly run: () => void;
}

export const isCommand = (entry: PaletteEntry): entry is PaletteCommandEntry =>
  typeof (entry as Partial<PaletteCommandEntry>).run === 'function';

const source = (id: string, order: number, entries: Signal<readonly PaletteEntry[]>): PaletteSource => ({
  id,
  labelKey: `palette.groups.${id}`,
  order,
  entries,
});

/** A translate that re-runs when the language changes (the computed reads `LanguageService.current`). */
function translator(): (key: string, params?: Record<string, unknown>) => string {
  const transloco = inject(TranslocoService);
  const language = inject(LanguageService);
  return (key, params) => {
    language.current();
    return transloco.translate(key, params);
  };
}

/** Copies `command` and says so in the toast (the same words as the command chip). */
function copier(): (command: string) => void {
  const doc = inject(DOCUMENT);
  const toast = inject(ToastService);
  const transloco = inject(TranslocoService);
  return (command) => {
    void writeClipboard(command, doc).then((done) => {
      toast.show(transloco.translate(done ? 'common.copied' : 'common.copyFallback', { command }));
    });
  };
}

function recentSource(): PaletteSource {
  return source('recent', 10, inject(PaletteRecent).entries.asReadonly());
}

function nextUpSource(): PaletteSource {
  const index = inject(PaletteIndex);
  const copy = copier();
  return source(
    'nextUp',
    20,
    computed(() => {
      const ws = index.current();
      if (ws === null) return [];
      return ws.nextUp.flatMap((id): PaletteCommandEntry[] => {
        const spec = ws.specs.find((row) => row.id === id);
        const command = spec?.nextCommand;
        if (spec === undefined || command === null || command === undefined) return [];
        return [
          {
            id: `${ws.slug}/${id}`,
            label: command,
            meta: spec.title,
            chip: id,
            link: specLink(ws.slug, id),
            keywords: [id, spec.slug],
            run: () => {
              copy(command);
            },
          },
        ];
      });
    }),
  );
}

function workspacesSource(): PaletteSource {
  const data = inject(ShellData);
  return source(
    'workspaces',
    30,
    computed(() =>
      data.workspaceList().map((ws) => ({
        id: ws.slug,
        label: ws.name,
        meta: ws.pathTail,
        link: ['/w', ws.slug],
        keywords: [ws.slug, ws.pathTail],
      })),
    ),
  );
}

function specsSource(): PaletteSource {
  const index = inject(PaletteIndex);
  return source(
    'specs',
    40,
    computed(() =>
      index.workspaces().flatMap((ws) =>
        ws.specs.map((spec) => ({
          id: `${ws.slug}/${spec.id}`,
          label: spec.title,
          meta: spec.phase === null ? ws.name : `${spec.phase} · ${ws.name}`,
          chip: spec.id,
          link: specLink(ws.slug, spec.id),
          keywords: [spec.id, spec.slug, ws.name],
        })),
      ),
    ),
  );
}

function servicesSource(): PaletteSource {
  const index = inject(PaletteIndex);
  const view = inject(DOCUMENT).defaultView;
  return source(
    'services',
    60,
    computed(() =>
      (index.current()?.services ?? []).map(
        (service): PaletteCommandEntry => ({
          id: `service/${String(service.port)}`,
          label: `localhost:${String(service.port)}`,
          meta: service.label ?? service.process,
          link: service.url,
          keywords: [String(service.port), service.process, service.label ?? ''],
          run: () => {
            view?.open(service.url, '_blank', 'noopener');
          },
        }),
      ),
    ),
  );
}

function actionsSource(): PaletteSource {
  const t = translator();
  const index = inject(PaletteIndex);
  const state = inject(ShellState);
  const keyboard = inject(KeyboardService);
  const theme = inject(ThemeService);
  const language = inject(LanguageService);
  const settings = inject(SettingsService);
  const copy = copier();
  return source(
    'actions',
    70,
    computed(() => {
      const here = state.ws();
      const specId = state.specId();
      const actions: Array<PaletteEntry | PaletteCommandEntry> = [
        { id: 'action/all-workspaces', label: t('palette.actions.allWorkspaces'), link: ['/'], keywords: ['workspaces', 'home'] },
      ];
      const next = specId === null ? null : (index.current()?.specs.find((row) => row.id === specId)?.nextCommand ?? null);
      if (here !== null && specId !== null && next !== null) {
        actions.push({
          id: 'action/copy-next',
          label: t('palette.actions.copyNext', { spec: specId }),
          link: specLink(here, specId),
          keywords: ['copy', 'next', specId],
          run: () => {
            copy(next);
          },
        } satisfies PaletteCommandEntry);
      }
      const url = here === null ? '/' : `/w/${here}`;
      actions.push(
        {
          id: 'action/refresh',
          label: t('palette.actions.refresh'),
          link: url,
          keywords: ['refresh', 'reload'],
          run: () => {
            index.refresh();
          },
        } satisfies PaletteCommandEntry,
        {
          id: 'action/theme',
          label: t('palette.actions.theme'),
          link: url,
          keywords: ['theme', 'dark', 'light'],
          run: () => {
            void theme.setMode(theme.resolved() === 'dark' ? 'light' : 'dark');
          },
        } satisfies PaletteCommandEntry,
        {
          id: 'action/language',
          label: t('palette.actions.language'),
          link: url,
          keywords: ['language', 'sprache', 'english', 'deutsch'],
          run: () => {
            // Stored like the settings page's choice; `startSettings` applies it to Transloco.
            void settings.update({ language: language.current() === 'en' ? 'de' : 'en' });
          },
        } satisfies PaletteCommandEntry,
        {
          id: 'action/shortcuts',
          label: t('palette.actions.shortcuts'),
          link: url,
          keywords: ['shortcuts', 'keys', 'help'],
          run: () => {
            keyboard.openSheet();
          },
        } satisfies PaletteCommandEntry,
      );
      return actions;
    }),
  );
}

function archivedSource(): PaletteSource {
  const index = inject(PaletteIndex);
  return source(
    'archived',
    80,
    computed(() =>
      index.workspaces().flatMap((ws) =>
        ws.archive.map((spec) => ({
          id: `${ws.slug}/${spec.id}`,
          label: spec.title,
          meta: spec.archived === null ? ws.name : `${spec.archived} · ${ws.name}`,
          chip: spec.id,
          link: specLink(ws.slug, spec.id),
          keywords: [spec.id, spec.slug, ws.name],
        })),
      ),
    ),
  );
}

/**
 * Spec 001's own palette groups (T66): Recent 10, Next up 20, Workspaces 30, Specs 40, Services 60, Actions 70,
 * Archived 80, each one provider line on `PALETTE_SOURCES` like any other spec's group.
 */
export function providePaletteGroups(): Provider[] {
  return [recentSource, nextUpSource, workspacesSource, specsSource, servicesSource, actionsSource, archivedSource].map(
    (factory) => ({ provide: PALETTE_SOURCES, useFactory: factory, multi: true }),
  );
}
