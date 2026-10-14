import { computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';
import { type PaletteEntry, type PaletteSource } from '../../core/palette-sources';
import { ShellData } from '../../layout/shell/shell-data.service';
import { ShellState } from '../../layout/shell/shell-state.service';
import { planningTreeLink } from '../../layout/shell/areas';

/** Group orders after Workspaces (30) and Specs (40), before Services (60): spec 001 plan.md § "palette groups". */
export const FEATURES_ORDER = 50;
export const MILESTONES_ORDER = 55;

/**
 * `/w/<ws>/planning/tree?sel=feature:F2` as one URL (spec 026, ISC-167.1): the palette navigates a string with
 * `navigateByUrl`, and a router link array cannot carry the query. The router serialises it, so a workspace slug the
 * URL grammar cannot take verbatim (`100%`, `a;b` — slugs are folder basenames) is encoded the way every `routerLink`
 * encodes it.
 */
const onTree = (router: Router, ws: string, sel: string): string =>
  router.serializeUrl(router.createUrlTree(planningTreeLink(ws), { queryParams: { sel } }));

/**
 * The palette's Features group (spec 003, ISC-106): one entry per feature block of the open workspace's master,
 * in master order, leading to it on the planning tree. Empty, hence absent, without a workspace or a tree.
 */
export function featuresPaletteSource(): PaletteSource {
  const state = inject(ShellState);
  const data = inject(ShellData);
  const router = inject(Router);
  const entries = computed<readonly PaletteEntry[]>(() => {
    const ws = state.ws();
    const model = data.planningModel();
    if (ws === null || model === null) return [];
    return model.features.map((feature) => ({
      id: `feature-${feature.id}`,
      label: feature.name,
      chip: feature.id,
      meta: `${String(feature.closed)}/${String(feature.total)}`,
      link: onTree(router, ws, `feature:${feature.id}`),
      keywords: [feature.id, feature.name, 'feature', 'epic'],
    }));
  });
  return { id: 'features', labelKey: 'palette.groups.features', order: FEATURES_ORDER, entries };
}

/**
 * The palette's Milestones group (ISC-104, ISC-106): one entry per milestone some spec names, in the model's order
 * (target ascending), leading to it on the planning tree. A block entry no spec names adds none, so the group is
 * absent exactly when the tree has no milestone level (`ShellData.hasMilestones`).
 *
 * No `chip`: the ranking reads the chip as the entry's ID (`palette-ranking.ts`), and a milestone has no mono id. The
 * served state rides in `meta` as a word in the UI language, after the target date when there is one (design.md
 * § Palette: the date on the right); the closed/total count stays on the page. The state stays out of `keywords`
 * too, which rank on the same ID tiers: "up" must reach a feature named "Upload" before every upcoming milestone.
 */
export function milestonesPaletteSource(): PaletteSource {
  const state = inject(ShellState);
  const data = inject(ShellData);
  const router = inject(Router);
  const transloco = inject(TranslocoService);
  const lang = toSignal(transloco.langChanges$, { initialValue: transloco.getActiveLang() });
  const entries = computed<readonly PaletteEntry[]>(() => {
    const ws = state.ws();
    const model = data.planningModel();
    const active = lang();
    if (ws === null || model === null) return [];
    return model.milestones
      .filter((milestone) => milestone.specs.length > 0)
      .map((milestone) => {
        const word = transloco.translate(`planning.milestones.stateWord.${milestone.state}`, {}, active);
        return {
          id: `milestone-${milestone.slug}`,
          label: milestone.name,
          meta: milestone.target === null ? word : `${milestone.target} · ${word}`,
          link: onTree(router, ws, `milestone:${milestone.slug}`),
          keywords: [milestone.name, milestone.slug, 'milestone', 'release'],
        };
      });
  });
  return { id: 'milestones', labelKey: 'palette.groups.milestones', order: MILESTONES_ORDER, entries };
}
