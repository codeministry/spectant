import { computed, type Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import type { TranslocoService } from '@jsverse/transloco';
import type { SpecPageModel } from '../../../../../core/src/files';
import { stageIndex, TRACK_STAGES } from '../../core/model/stage-track';
import { specLink } from '../../layout/shell/areas';
import type { ShellData } from '../../layout/shell/shell-data.service';
import type { ShellState } from '../../layout/shell/shell-state.service';
import type { BriefModel } from '../../shared/brief/brief';

/**
 * The derivations several spec tabs share (spec 061): each reads the spec payload the shell already loads
 * (`ShellData.spec`) as it is and counts nothing (ISC-72). Every helper builds signals; the stores and the parts that
 * render the spec call them in a field initialiser, so the one `toSignal` among them runs in an injection context.
 */

/** Where a spec tab stands: `loading` only before the first answer, so a reload keeps the tab on screen. */
export type SpecView = 'loading' | 'ok' | 'unserved' | 'error';

/** The spec payload once the spec route answered `ok`, else null. */
export function specModel(data: Pick<ShellData, 'spec'>): Signal<SpecPageModel | null> {
  return computed(() => {
    const result = data.spec.value();
    return result?.kind === 'ok' ? result.body : null;
  });
}

/** The tab's state: the skeleton before the first answer, the placeholder while the route is unserved (a catch-all 404). */
export function specView(data: Pick<ShellData, 'spec'>): Signal<SpecView> {
  return computed(() => {
    const result = data.spec.value();
    if (result === undefined) return data.spec.error() ? 'error' : 'loading';
    if (result.kind === 'ok') return 'ok';
    if (result.kind === 'not-found' && !result.served) return 'unserved';
    return 'error';
  });
}

/** The route's workspace and spec, the parameters of a spec route's call; undefined until both are known. */
export function specParams(state: Pick<ShellState, 'ws' | 'specId'>): Signal<{ ws: string; id: string } | undefined> {
  return computed(() => {
    const ws = state.ws();
    const id = state.specId();
    return ws === null || id === null ? undefined : { ws, id };
  });
}

/** `/w/:ws/s/:id/<tab>` as a router link array. */
export function specTabLink(state: Pick<ShellState, 'ws' | 'specId'>, tab = ''): string[] {
  return specLink(state.ws() ?? '', state.specId() ?? '', tab);
}

/** The ring's fill: the closed share of the claims, drawn only; the "n/m claims closed" text beside it carries the value. */
export function claimsRatio(model: Signal<SpecPageModel | null>): Signal<number | null> {
  return computed(() => {
    const claims = model()?.keyNumbers.claims;
    return claims && claims.total > 0 ? (claims.closed / claims.total) * 100 : null;
  });
}

/** The spec's slice of `specs/tldr.md` in the Brief's shape; null when no TL;DR item names this spec. */
export function specBrief(model: Signal<SpecPageModel | null>): Signal<BriefModel | null> {
  return computed(() => {
    const tldr = model()?.tldr;
    return tldr?.brief ? { markdown: tldr.brief, generated: tldr.generated, stale: tldr.stale } : null;
  });
}

/** The active UI language as a signal; call it in an injection context. */
export function activeLang(transloco: TranslocoService): Signal<string> {
  return toSignal(transloco.langChanges$, { initialValue: transloco.getActiveLang() });
}

/** What `ui-stage-track` draws in labelled mode: the translated stage names, the spec's stage and the track's label. */
export interface StageTrackView {
  readonly labels: Signal<readonly string[]>;
  readonly current: Signal<number>;
  readonly aria: Signal<string>;
}

/** The labelled stage track of the spec (the track's stages, the head's stage), re-read on a language change. */
export function stageTrack(transloco: TranslocoService, lang: Signal<string>, model: Signal<SpecPageModel | null>): StageTrackView {
  const labels = computed(() => {
    lang();
    return TRACK_STAGES.map((stage) => transloco.translate(`stages.${stage}`));
  });
  const current = computed(() => stageIndex(model()?.head.stage ?? ''));
  const aria = computed(() => {
    const all = labels();
    const index = Math.min(current(), all.length - 1);
    return transloco.translate('stages.position', { index: index + 1, total: all.length, stage: all[index] ?? '' });
  });
  return { labels, current, aria };
}
