import { computed, inject } from '@angular/core';
import { KeyboardService } from '../shell/keyboard.service';
import { LanguageService } from '../../core/language.service';
import type { PaletteEntry, PaletteSource } from '../../core/palette-sources';
import { AssistantDot } from '../assistant/assistant.service';
import { SettingsService } from '../../core/settings.service';
import { ThemeService } from '../../core/theme.service';
import { specLink, workspaceLink } from '../shell/areas';
import { ShellState } from '../shell/shell-state.service';
import type { PaletteCommandEntry } from './palette-entries';
import { PaletteIndex } from './palette-index';
import { copier, source, translator } from './palette-source-kit';

/** The Actions group (70): the app's own commands and pages, some of them acting instead of navigating. */
export function actionsSource(): PaletteSource {
  const t = translator();
  const assistant = inject(AssistantDot);
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
      // Spec 008 (T117): the workspace board ("Board", never the spec's round board) while a workspace is open, and help.
      if (here !== null) {
        actions.push({
          id: 'action/open-board',
          label: t('board.workspace.open'),
          link: workspaceLink(here, 'board'),
          keywords: ['board', 'kanban', 'stages', 'cards'],
        });
        // Spec 026 (ISC-167): the planning page, which opens the tree lens.
        actions.push({
          id: 'action/open-planning',
          label: t('palette.actions.planning'),
          link: workspaceLink(here, 'planning'),
          keywords: ['planning', 'features', 'milestones', 'tree', 'gantt', 'timeline', 'graph'],
        });
        // Spec 024 (T58, ISC-150.1): the Library, a menu page (a mock until spec 017).
        // Spec 024 (T58, ISC-150.1): the Library, a menu page; since spec 017 (T43, ISC-157.1) it also stands for the
        // former Tech group, whose words stay search keys so "tech" or "architecture" still finds where it went.
        actions.push({
          id: 'action/open-library',
          label: t('palette.actions.library'),
          link: workspaceLink(here, 'library'),
          keywords: ['library', 'docs', 'documents', 'tech', 'architecture'],
        });
      }
      // Spec 024 (T58, ISC-150.1): Settings · Workspaces, also reached from the gear and the Settings card.
      actions.push({
        id: 'action/settings-workspaces',
        label: t('palette.actions.settingsWorkspaces'),
        link: ['/settings', 'workspaces'],
        keywords: ['settings', 'workspaces', 'register', 'add'],
      });
      actions.push({ id: 'action/help', label: t('palette.actions.help'), link: ['/help'], keywords: ['help', 'guide', 'glossary', 'workflow'] });
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
          id: 'action/open-assistant',
          label: t('palette.actions.openAssistant'),
          link: url,
          keywords: ['assistant', 'chat', 'dot', 'ask'],
          demo: true,
          run: () => {
            assistant.show(null);
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
