import type { Provider } from '@angular/core';
import { PALETTE_SOURCES } from '../../core/palette-sources';
import { actionsSource } from './palette-actions';
import {
  archivedSource,
  claimsSource,
  ideasSource,
  nextUpSource,
  pagesSource,
  recentSource,
  servicesSource,
  specsSource,
  workspacesSource,
} from './palette-group-sources';

export {
  CLAIMS_ORDER,
  hasPhase,
  IDEAS_ORDER,
  isClaim,
  isCommand,
  isIdea,
  PAGES_ORDER,
  type PaletteClaimEntry,
  type PaletteCommandEntry,
  type PaletteIdeaEntry,
  type PaletteSpecEntry,
} from './palette-entries';

/**
 * Spec 001's own palette groups (T66): Recent 10, Next up 20, spec 058's Pages 25, Workspaces 30, Specs 40, Services 60, Actions 70,
 * Archived 80, plus spec 008's Ideas 45 and spec 019's Claims 15, each one provider line on `PALETTE_SOURCES` like any
 * other spec's group. Spec 023's Tech group went with the tech page into the Library (spec 017, T43, ISC-157.1): the
 * Library is the Actions group's "Open library".
 */
export function providePaletteGroups(): Provider[] {
  return [recentSource, claimsSource, nextUpSource, pagesSource, workspacesSource, specsSource, ideasSource, servicesSource, actionsSource, archivedSource].map(
    (factory) => ({ provide: PALETTE_SOURCES, useFactory: factory, multi: true }),
  );
}
