import { computed, DOCUMENT, inject, type Provider, type Signal } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import type { ClaimGlyphState } from '../../../../../core/src/files';
import { KeyboardService } from '../../core/keyboard.service';
import { LanguageService } from '../../core/language.service';
import { PALETTE_SOURCES, type PaletteEntry, type PaletteSource } from '../../core/palette-sources';
import { SettingsService } from '../../core/settings.service';
import { ThemeService } from '../../core/theme.service';
import { writeClipboard } from '../../shared/ui/command-chip/command-chip';
import { CLAIM_GLYPHS } from '../../shared/ui/glyph/states';
import { toneMark } from '../../shared/ui/tone';
import { ToastService } from '../../shared/ui/toast/toast';
import { specLink, workspaceLink } from '../shell/areas';
import { TECH_TABS, techLink } from '../shell/page-tabs';
import { ShellData } from '../shell/shell-data.service';
import { ShellState } from '../shell/shell-state.service';
import { PaletteIndex } from './palette-index';
import { CLAIMS_GROUP } from './palette-ranking';
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

/**
 * A claim hit (019 T4 · ISC-139): the palette draws its status as a dot in the claim glyph's tone plus the state word
 * (`palette.claimStates.*`), and names the option with `palette.claimHit` and that word.
 */
export interface PaletteClaimEntry extends PaletteEntry {
  readonly claim: {
    readonly status: ClaimGlyphState;
    readonly statusWord: string;
    /** The dot's colour, a `var()` of the theme (the claim glyph's tone, `toneMark`). */
    readonly dot: string;
    readonly accessibleName: string;
  };
}

export const isClaim = (entry: PaletteEntry): entry is PaletteClaimEntry =>
  typeof (entry as Partial<PaletteClaimEntry>).claim === 'object';

/** Before Next up (20): Recent shows only without a query and Claims only with one, so Claims never sits under it. */
export const CLAIMS_ORDER = 15;

/**
 * The Claims group (T4): every claim of every readable workspace (the open one first, then the others in list order;
 * each workspace's claims arrive once `PaletteIndex.claimsFor` has read them), its ISC as the chip, its line as the
 * label and `<workspace> · <spec>` as the meta. Enter opens `/w/<ws>/s/<spec>/claims#claim-<ISC>`, where the claims tab
 * scrolls to and focuses the card. Matching, the cap of eight hits and the lift for a claim-like query are the
 * ranking's (`rankGroups`, `rankClaim`); the entries keep the claim's number and status word as keywords.
 */
function claimsSource(): PaletteSource {
  const t = translator();
  const index = inject(PaletteIndex);
  const entries = computed<readonly PaletteEntry[]>(() =>
    index.workspaces().flatMap((ws) =>
      (index.claimsFor(ws.slug)() ?? []).map((claim): PaletteClaimEntry => {
        const text = claim.text.replace(/\s+/gu, ' ').trim();
        const statusWord = t(`palette.claimStates.${claim.status}`);
        const hit = t('palette.claimHit', { claim: claim.isc, text, spec: claim.specId, workspace: ws.name });
        return {
          id: `claim:${claim.ws}:${claim.isc}`,
          label: text,
          meta: `${ws.name} · ${claim.specId}`,
          chip: claim.isc,
          link: `/w/${claim.ws}/s/${claim.specId}/claims#claim-${claim.isc}`,
          keywords: [claim.isc.replace(/^ISC-/u, ''), statusWord],
          claim: { status: claim.status, statusWord, dot: toneMark(CLAIM_GLYPHS[claim.status].tone), accessibleName: `${hit}, ${statusWord}` },
        };
      }),
    ),
  );
  return { id: CLAIMS_GROUP, labelKey: `palette.groups.${CLAIMS_GROUP}`, order: CLAIMS_ORDER, entries };
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

/**
 * An idea of the open workspace (spec 008, ISC-124.2): the palette draws its chip in the idea chip's look (`lightbulb`,
 * dashed, the slug in mono). Not `ui-idea-chip` itself, which is a link: an option holds no control.
 */
export interface PaletteIdeaEntry extends PaletteEntry {
  readonly idea: true;
}

export const isIdea = (entry: PaletteEntry): entry is PaletteIdeaEntry => (entry as Partial<PaletteIdeaEntry>).idea === true;

/** Between Specs (40) and Features (50). */
export const IDEAS_ORDER = 45;

/**
 * The Ideas group (T117): every story of the open workspace in file-name order, its slug as the chip, its title as the
 * label and its feature id as the meta, searchable by title, slug and feature; Enter opens `/w/:ws/ideas/:slug`.
 */
function ideasSource(): PaletteSource {
  const state = inject(ShellState);
  const data = inject(ShellData);
  return source(
    'ideas',
    IDEAS_ORDER,
    computed(() => {
      const ws = state.ws();
      if (ws === null) return [];
      return data.ideas().map(
        (idea): PaletteIdeaEntry => ({
          id: `idea/${ws}/${idea.slug}`,
          label: idea.title,
          chip: idea.slug,
          ...(idea.feature === null ? {} : { meta: idea.feature }),
          link: ['/w', ws, 'ideas', idea.slug],
          keywords: [idea.slug, idea.title, idea.feature ?? '', 'idea'],
          idea: true,
        }),
      );
    }),
  );
}

/** After Milestones (55), before Services (60). */
export const TECH_ORDER = 57;

/**
 * The Tech group (spec 023, T21, ISC-134.2): the open workspace's tech page (`/w/:ws/tech`, which opens its first tab)
 * and one entry per tab, `Tech · <Tab>` (`/w/:ws/tech/<tab>`), in tab-bar order. The tab id and its label are keywords,
 * so "arch" ranks `Tech · Architecture` on the ID tiers. Empty outside a workspace the server knows.
 */
function techSource(): PaletteSource {
  const t = translator();
  const state = inject(ShellState);
  const data = inject(ShellData);
  const entries = computed<readonly PaletteEntry[]>(() => {
    const ws = state.ws();
    if (ws === null || data.workspaceMissing()) return [];
    const meta = data.workspaceName(ws);
    const page: PaletteEntry = { id: `tech/${ws}`, label: t('tech.palette.page'), meta, link: workspaceLink(ws, 'tech'), keywords: ['tech'] };
    const tabs = TECH_TABS.map((tab): PaletteEntry => {
      const name = t(`tech.tabs.${tab}`);
      return { id: `tech/${ws}/${tab}`, label: t('tech.palette.tab', { tab: name }), meta, link: techLink(ws, tab), keywords: ['tech', tab, name] };
    });
    return [page, ...tabs];
  });
  return { id: 'tech', labelKey: 'tech.title', order: TECH_ORDER, entries };
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
      // Spec 008 (T117): the workspace board ("Board", never the spec's round board) while a workspace is open, and help.
      if (here !== null) {
        actions.push({
          id: 'action/open-board',
          label: t('board.workspace.open'),
          link: workspaceLink(here, 'board'),
          keywords: ['board', 'kanban', 'stages', 'cards'],
        });
      }
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
 * Archived 80, plus spec 008's Ideas 45, spec 023's Tech 57 and spec 019's Claims 15, each one provider line on
 * `PALETTE_SOURCES` like any other spec's group.
 */
export function providePaletteGroups(): Provider[] {
  return [recentSource, claimsSource, nextUpSource,workspacesSource, specsSource, ideasSource, techSource, servicesSource, actionsSource, archivedSource].map(
    (factory) => ({ provide: PALETTE_SOURCES, useFactory: factory, multi: true }),
  );
}
