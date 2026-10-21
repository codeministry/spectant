import { computed, DOCUMENT, inject } from '@angular/core';
import type { PaletteEntry, PaletteSource } from '../../core/palette-sources';
import { CLAIM_GLYPHS } from '../../shared/ui/glyph/states';
import { toneMark } from '../../shared/ui/tone';
import { specLink, workspaceLink, workspacePageById } from '../shell/areas';
import { ShellData } from '../shell/shell-data.service';
import { ShellState } from '../shell/shell-state.service';
import { specCountOf } from '../shell/spec-count';
import { CLAIMS_ORDER, IDEAS_ORDER, PAGES_ORDER, type PaletteClaimEntry, type PaletteCommandEntry, type PaletteIdeaEntry } from './palette-entries';
import { PaletteIndex } from './palette-index';
import { CLAIMS_GROUP } from './palette-ranking';
import { PaletteRecent } from './palette-recent';
import { copier, source, translator } from './palette-source-kit';

/** The palette's groups (spec 001 T66 and later specs) but Actions, which is `palette-actions.ts`. */

export function recentSource(): PaletteSource {
  return source('recent', 10, inject(PaletteRecent).entries.asReadonly());
}

/**
 * The Claims group (T4): every claim of every readable workspace (the open one first, then the others in list order;
 * each workspace's claims arrive once `PaletteIndex.claimsFor` has read them), its ISC as the chip, its line as the
 * label and `<workspace> · <spec>` as the meta. Enter opens `/w/<ws>/s/<spec>/claims#claim-<ISC>`, where the claims tab
 * scrolls to and focuses the card. Matching, the cap of eight hits and the lift for a claim-like query are the
 * ranking's (`rankGroups`, `rankClaim`); the entries keep the claim's number and status word as keywords.
 */
export function claimsSource(): PaletteSource {
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

export function nextUpSource(): PaletteSource {
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

export function workspacesSource(): PaletteSource {
  const t = translator();
  const data = inject(ShellData);
  return source(
    'workspaces',
    30,
    computed(() =>
      data.workspaceList().map((ws) => ({
        id: ws.slug,
        label: ws.name,
        // The meta is the spec count ("6 specs"); the path tail stays a search key.
        meta: specCountOf(ws.counts) === null ? ws.pathTail : t(specCountOf(ws.counts) === 1 ? 'palette.wsSpecs.one' : 'palette.wsSpecs.other', { count: specCountOf(ws.counts) }),
        link: ['/w', ws.slug],
        keywords: [ws.slug, ws.pathTail],
      })),
    ),
  );
}

/** The pages the Pages group lists, in the menu's order: the workspace dashboard before its spec list. */
const PALETTE_PAGES = ['dashboard', 'specs'] as const;

/**
 * The Pages group (spec 058 T23, ISC-394): the open workspace's Dashboard (`/w/<ws>`), then its Specs list
 * (`/w/<ws>/specs`), named as the page menu names them, under the menu's own heading ("Pages"). Each line carries the
 * workspace as its meta, so the workspace dashboard is never taken for the spec area "Dashboard"; the workspace's
 * name and slug stay search keys.
 */
export function pagesSource(): PaletteSource {
  const t = translator();
  const state = inject(ShellState);
  const data = inject(ShellData);
  const entries = computed<readonly PaletteEntry[]>(() => {
    const ws = state.ws();
    if (ws === null || data.workspaceMissing()) return [];
    const name = data.workspaceName(ws);
    return PALETTE_PAGES.map((id) => {
      const label = t(workspacePageById(id).labelKey);
      return { id: `page/${ws}/${id}`, label, meta: name, link: workspaceLink(ws, id), keywords: [id, label, ws, name] };
    });
  });
  return { id: 'pages', labelKey: 'shell.area.pageMenu', order: PAGES_ORDER, entries };
}

export function specsSource(): PaletteSource {
  const t = translator();
  const index = inject(PaletteIndex);
  return source(
    'specs',
    40,
    computed(() =>
      index.workspaces().flatMap((ws) =>
        ws.specs.map((spec) => ({
          id: `${ws.slug}/${spec.id}`,
          label: spec.title,
          meta: ws.name,
          ...(spec.phase === null ? {} : { phase: spec.phase, phaseLabel: t(`phases.${spec.phase}`) }),
          chip: spec.id,
          link: specLink(ws.slug, spec.id),
          keywords: [spec.id, spec.slug, ws.name],
        })),
      ),
    ),
  );
}

/**
 * The Ideas group (T117): every story of the open workspace in file-name order, its slug as the chip, its title as the
 * label and its feature id as the meta, searchable by title, slug and feature; Enter opens `/w/:ws/ideas/:slug`.
 */
export function ideasSource(): PaletteSource {
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

export function servicesSource(): PaletteSource {
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

export function archivedSource(): PaletteSource {
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
