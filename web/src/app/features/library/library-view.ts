import type { SafeHtml } from '@angular/platform-browser';
import type { ParamMap } from '@angular/router';
import type { LibraryCatalog, LibraryDoc, SpecGroupHead, SpecType } from '../../../../../core/src/files';
import { renderDocsMarkdown } from '../../../../../core/src/markdown-docs';
import type { Stage } from '../../../../../core/src/stage';
import { STAGE_LOOK } from '../../layout/spec-head/spec-head';
import type { IconName } from '../../shared/icons/icons';
import type { Tone } from '../../shared/ui/tone';
import { TYPE_GLYPHS } from '../../shared/ui/type-glyph/type-glyph';
import {
  filterParams,
  highlight,
  type LibraryFilter,
  type LibraryGroup,
  matches,
  parseFilter,
  specKey,
  specSlug,
  type TextRun,
  WORKSPACE_SPEC,
} from './library-model';

/*
 * The library list's view shapes (spec 017, T27, T30, T32, ISC-156, ISC-156.1, ISC-157): control counts, the tech
 * placeholder, group heads, the address params and the rows, groups and evidence as the page draws them. No Angular
 * state; the page's store builds them.
 */

/** The two control counts of the card's first row (design.md 017 § Across viewports; ISC-156.1), in this order. */
export type ControlKey = 'missing' | 'stale';

/** One control count as drawn: its `?state=` value, the number, the icon, whether it filters now. */
export interface ControlView {
  readonly key: ControlKey;
  readonly count: number;
  /** `file-x` for missing, `triangle-alert` for stale; `circle-check` at zero. */
  readonly icon: IconName;
  readonly pressed: boolean;
  /** The accessible name's key: `none` at zero, else `one` / `other` by the count. */
  readonly labelKey: string;
}

const CONTROL_ICON: Readonly<Record<ControlKey, IconName>> = { missing: 'file-x', stale: 'triangle-alert' };

/** The control counts of a catalog under the current `?state=`: missing first, then stale. */
export function controlViews(catalog: Pick<LibraryCatalog, 'missing' | 'stale'>, state: LibraryFilter['state']): readonly ControlView[] {
  return (['missing', 'stale'] as const).map((key) => {
    const count = catalog[key];
    const plural = count === 0 ? 'none' : count === 1 ? 'one' : 'other';
    return { key, count, icon: count === 0 ? 'circle-check' : CONTROL_ICON[key], pressed: state === key, labelKey: `library.control.${key}.${plural}` };
  });
}

/**
 * The row an absent `specs/tech.md` stands as (design.md 017 § 8, § Across viewports): in the workspace-wide group,
 * dimmed, without the "missing" flag and outside every count (ISC-155.2 names spec documents only); its reader is the
 * empty state, which names no command. Core never marks a tech document missing, so `tech` with `missing` names this row alone.
 */
export const TECH_PLACEHOLDER: LibraryDoc = {
  path: 'tech.md',
  type: 'tech',
  spec: WORKSPACE_SPEC,
  title: 'tech.md',
  modified: null,
  state: 'missing',
  media: 'markdown',
};

/** The tech placeholder when the catalog holds documents but no tech.md; null otherwise. */
export const techPlaceholderOf = (catalog: Pick<LibraryCatalog, 'docs'>): LibraryDoc | null =>
  catalog.docs.length === 0 || catalog.docs.some((doc) => doc.type === 'tech') ? null : TECH_PLACEHOLDER;

/** Whether the list shows the placeholder under `filter`: as a tech document would, under the state "all" only. */
export const showsPlaceholder = (filter: LibraryFilter): boolean => filter.state === 'all' && matches({ ...TECH_PLACEHOLDER, state: 'ok' }, filter);

/** A spec group's head as drawn (ISC-157): core's values, the chips' looks, and Goal and Approach rendered once. */
export interface GroupHeadView {
  readonly head: SpecGroupHead;
  /** The spec's number (`?spec=` form). */
  readonly key: string;
  readonly slug: string;
  readonly typeIcon: IconName | undefined;
  readonly stageTone: Tone;
  readonly stageIcon: IconName | undefined;
  /** The `## Goal` and the first paragraph of `## Approach` as the former tech tab Specs rendered them; null without. */
  readonly goal: string | null;
  readonly approach: string | null;
}

/**
 * The head of a spec group from core's `SpecGroupHead`: type and stage chip looks (the spec head's `STAGE_LOOK`), the
 * Goal and Approach sources through core's renderer with the ids the former tech tab gave them (`spec-NNN-goal-`).
 */
export function groupHeadView(head: SpecGroupHead): GroupHeadView {
  const key = specKey(head.spec);
  const type: SpecType | null = head.type;
  const look = Object.hasOwn(STAGE_LOOK, head.stage) ? STAGE_LOOK[head.stage as Stage] : { tone: 'neutral' as const, icon: undefined };
  const render = (source: string | null, part: string): string | null =>
    source === null ? null : renderDocsMarkdown(source, { idPrefix: `spec-${key}-${part}-` }).html;
  return {
    head,
    key,
    slug: specSlug(head.spec),
    typeIcon: type === null ? undefined : TYPE_GLYPHS[type],
    stageTone: look.tone,
    stageIcon: look.icon,
    goal: render(head.goal, 'goal'),
    approach: render(head.approach, 'approach'),
  };
}

/** The server's full-text search waits this long after the last keystroke (title and path matches show at once). */
export const SEARCH_DEBOUNCE_MS = 200;

/** Resolves after `ms`, rejects as soon as `signal` aborts (a newer search text superseded this one). */
export function pause(ms: number, signal: AbortSignal): Promise<void> {
  const aborted = (): Error => new DOMException('The search text changed', 'AbortError');
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(aborted());
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(aborted());
      },
      { once: true },
    );
  });
}

/**
 * The query params that write `filter` into the address, the ones the list owns (`q`, `type`, `spec`, `state`,
 * `archived`); a default is `null`, which removes the param. Every other param is left as it is
 * (`queryParamsHandling: merge`).
 */
export function addressParams(filter: LibraryFilter): Readonly<Record<'q' | 'type' | 'spec' | 'state' | 'archived', string | null>> {
  const params = filterParams(filter);
  return {
    q: params['q'] ?? null,
    type: params['type'] ?? null,
    spec: params['spec'] ?? null,
    state: params['state'] ?? null,
    archived: params['archived'] ?? null,
  };
}

export const sameFilter = (a: LibraryFilter, b: LibraryFilter): boolean =>
  a.query === b.query && a.type === b.type && a.spec === b.spec && a.state === b.state && a.archived === b.archived;

/** The filter a route's query params name. */
export const filterOf = (params: ParamMap): LibraryFilter => parseFilter((name) => params.get(name));

/** A document as one list row: the highlighted title and meta line beside the document itself. */
export interface RowView {
  readonly doc: LibraryDoc;
  readonly title: readonly TextRun[];
  readonly meta: readonly TextRun[] | null;
  /** The meta line is the server's full-text snippet, not the path. */
  readonly snippet: boolean;
  /** The absent tech.md (`TECH_PLACEHOLDER`): dimmed, no flag, no `data-library-entry`, outside every count. */
  readonly placeholder: boolean;
}

/** A group head with its Goal and Approach as trusted HTML (core's renderer escapes every text). */
export interface HeadDraw extends GroupHeadView {
  readonly goalHtml: SafeHtml | null;
  readonly approachHtml: SafeHtml | null;
}

/** A spec's evidence subgroup as shown: whether it is open, the revealed rows and how many still wait. */
export interface EvidenceView {
  readonly count: number;
  readonly open: boolean;
  readonly rows: readonly RowView[];
  readonly rest: number;
  /** What the next "Show more" reveals: a block, or the rest when less than a block waits. */
  readonly next: number;
}

export interface GroupView {
  readonly group: LibraryGroup;
  /** A spec group's head; null for the workspace-wide group (it keeps its eyebrow) and a spec core has no head for. */
  readonly head: HeadDraw | null;
  readonly rows: readonly RowView[];
  readonly evidence: EvidenceView | null;
}

/** A catalogue lookup with its params, as `TranslocoService.translate` gives it. */
export type Translate = (key: string, params?: Record<string, unknown>) => string;

/** The document's file (or prototype folder) as the workspace names it: below `specs/`. */
export const filePath = (doc: Pick<LibraryDoc, 'path'>): string => `specs/${doc.path}`;

/**
 * The tech placeholder in the workspace-wide group where tech.md would stand (after the constitution), the group
 * added in front when no workspace-wide document matched; the group's count stays the catalog's.
 */
export function withPlaceholder(views: readonly GroupView[], doc: LibraryDoc, t: Translate): readonly GroupView[] {
  const row: RowView = {
    doc,
    title: [{ text: doc.title, hit: false }],
    meta: [{ text: t('library.tech.notCreated', { path: filePath(doc) }), hit: false }],
    snippet: false,
    placeholder: true,
  };
  const workspace = views.find((view) => view.group.spec === WORKSPACE_SPEC);
  if (workspace === undefined) {
    const group: LibraryGroup = { spec: WORKSPACE_SPEC, key: WORKSPACE_SPEC, head: null, docs: [], evidence: null, count: 0 };
    return [{ group, head: null, rows: [row], evidence: null }, ...views];
  }
  const at = workspace.rows.findIndex((shown) => shown.doc.type !== 'constitution');
  const rows = at < 0 ? [...workspace.rows, row] : [...workspace.rows.slice(0, at), row, ...workspace.rows.slice(at)];
  return views.map((view) => (view === workspace ? { ...view, rows } : view));
}

/** The meta line under the title: the file (or folder) below `specs/`; an image says so, a prototype lists pages. */
export function metaRuns(doc: LibraryDoc, query: string, t: Translate): readonly TextRun[] | null {
  if (doc.media === 'prototype') {
    const pages = doc.pages ?? [];
    return [{ text: t(pages.length === 1 ? 'library.meta.prototype.one' : 'library.meta.prototype.other', { count: pages.length, pages: pages.join(', ') }), hit: false }];
  }
  const path = filePath(doc);
  if (doc.media === 'image') return [{ text: t('library.meta.image', { path }), hit: false }];
  return highlight(path, query);
}
