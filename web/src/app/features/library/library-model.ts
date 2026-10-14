import type {
  LibraryCatalog,
  LibraryDoc,
  LibraryDocType,
  LibraryFogLine,
  SpecGroupHead,
} from '../../../../../core/src/files';
import { specRefMatches } from '../../../../../core/src/spec-ref';

/**
 * The library list over core's `LibraryCatalog` (spec 017, T26, ISC-156, ISC-156.2; design.md § Across viewports).
 * Pure functions, no Angular: the page holds the catalog, the filter (from the address) and the server's search hits,
 * and asks this module what to show. Nothing here re-reads a document; titles, states and heads are core's.
 *
 * - Groups: "workspace-wide" first (constitution, tech, TL;DR, ideas), then the specs in ascending number, each spec
 *   exactly once, whatever order the catalog lists its documents in.
 * - In a spec group the present documents come first, the missing ones after them, each run in catalog order.
 * - A spec's `evidence` documents never stand in the list itself: they form one collapsed subgroup with its count,
 *   revealed in blocks of `EVIDENCE_BLOCK`; a search or the type filter `evidence` opens it.
 * - Type pills only for the types the catalog of the context holds, never Decisions (`context`, a section of spec.md
 *   now) and never Notes (not in the catalog).
 */

/** `LibraryDoc.spec` of a document outside every spec folder; also the `?spec=` value of the workspace-wide group. */
export const WORKSPACE_SPEC = 'workspace';

/** The evidence subgroup reveals this many documents per block (plan 017 § Risks: ~2,300 evidence files in one spec). */
export const EVIDENCE_BLOCK = 50;

/** Every pill type in pill order; `context` (Decisions) is left out on purpose. */
export const PILL_TYPES: readonly LibraryDocType[] = [
  'spec',
  'plan',
  'tasks',
  'design',
  'prototype',
  'artifact',
  'evidence',
  'constitution',
  'tech',
  'tldr',
  'idea',
];

/** The order of the workspace-wide group (design.md: Constitution, Tech, TL;DR, ideas). */
const WORKSPACE_ORDER: readonly LibraryDocType[] = ['constitution', 'tech', 'tldr', 'idea'];

/** `?state=`: every document, the stale ones, the missing ones, or the fog lines of the specs still open. */
export type LibraryStateFilter = 'all' | 'stale' | 'missing' | 'open';

export const STATE_FILTERS: readonly LibraryStateFilter[] = ['all', 'stale', 'missing', 'open'];

/**
 * The list's filters as the address carries them: `q` the raw search text, `type` a pill type or `all`, `spec` `all`,
 * `workspace` or a spec's number (`017`, the `?spec=` form of design.md), `state` one of `STATE_FILTERS`.
 */
export interface LibraryFilter {
  readonly query: string;
  readonly type: LibraryDocType | 'all';
  readonly spec: string;
  readonly state: LibraryStateFilter;
}

export const NO_FILTER: LibraryFilter = { query: '', type: 'all', spec: 'all', state: 'all' };

/** The server's search answer as the list needs it: matched path → plain snippet. */
export type SearchHits = ReadonlyMap<string, string>;

/** A spec's collapsed evidence: every matching document, the count, and whether a search or the filter opens it. */
export interface EvidenceGroup {
  readonly docs: readonly LibraryDoc[];
  readonly count: number;
  readonly open: boolean;
}

/** One group of the list: the workspace-wide documents, or one spec's (with its head when core has one). */
export interface LibraryGroup {
  /** `workspace` or the spec folder (`NNN-slug`), as `LibraryDoc.spec`. */
  readonly spec: string;
  /** `?spec=` value of the group: `workspace` or the spec's number. */
  readonly key: string;
  readonly head: SpecGroupHead | null;
  /** The documents shown as rows: present ones first, then missing ones; never evidence. */
  readonly docs: readonly LibraryDoc[];
  readonly evidence: EvidenceGroup | null;
  /** Rows plus evidence count: the group's document number. */
  readonly count: number;
}

/** One spec's open points under the filter "open". */
export interface FogGroup {
  readonly spec: string;
  readonly key: string;
  readonly lines: readonly LibraryFogLine[];
}

/** A spec select option: the `?spec=` value and the folder it names (`workspace` for the workspace-wide group). */
export interface SpecOption {
  readonly value: string;
  readonly spec: string;
}

const NUMBER = /^(\d+)-/u;

/** The `?spec=` value of a `LibraryDoc.spec`: the number of a spec folder, `workspace` as it is. */
export function specKey(spec: string): string {
  return NUMBER.exec(spec)?.[1] ?? spec;
}

/** The slug of a spec folder (`017-workspace-library` → `workspace-library`); the value itself without a number. */
export function specSlug(spec: string): string {
  const match = NUMBER.exec(spec);
  return match ? spec.slice(match[0].length) : spec;
}

/** Spec folders ascending by number, then by name. */
const bySpec = (a: string, b: string): number => a.localeCompare(b, 'en', { numeric: true });

const isPillType = (value: string): value is LibraryDocType => (PILL_TYPES as readonly string[]).includes(value);
const isState = (value: string): value is LibraryStateFilter => (STATE_FILTERS as readonly string[]).includes(value);

/**
 * The filter a query string names (`?q=`, `?type=`, `?spec=`, `?state=`); an unknown type or state falls back to
 * `all`, so a hand-edited address never empties the list by a typo. `spec` is taken as it is (`specKey` form).
 */
export function parseFilter(param: (name: string) => string | null): LibraryFilter {
  const type = param('type') ?? 'all';
  const state = param('state') ?? 'all';
  const spec = param('spec') ?? '';
  return {
    query: param('q') ?? '',
    type: isPillType(type) ? type : 'all',
    spec: spec === '' ? 'all' : spec,
    state: isState(state) ? state : 'all',
  };
}

/** The query params of a filter, defaults left out (`?q=`, `?type=`, `?spec=`, `?state=`). */
export function filterParams(filter: LibraryFilter): Record<string, string> {
  const params: Record<string, string> = {};
  if (filter.query !== '') params['q'] = filter.query;
  if (filter.type !== 'all') params['type'] = filter.type;
  if (filter.spec !== 'all') params['spec'] = filter.spec;
  if (filter.state !== 'all') params['state'] = filter.state;
  return params;
}

/**
 * The type pills for the documents of the context (the whole catalog, or one spec's in the spec area): the types it
 * holds, in `PILL_TYPES` order. Depends on the catalog, not on the matches, so the set stays stable while filtering.
 */
export function typePills(docs: readonly LibraryDoc[]): readonly LibraryDocType[] {
  const present = new Set(docs.map((doc) => doc.type));
  return PILL_TYPES.filter((type) => present.has(type));
}

/** The spec select: `workspace` when there are workspace-wide documents, then every spec ascending, each once. */
export function specOptions(docs: readonly LibraryDoc[]): readonly SpecOption[] {
  const specs = [...new Set(docs.map((doc) => doc.spec))];
  const folders = specs.filter((spec) => spec !== WORKSPACE_SPEC).sort(bySpec);
  return [...(specs.includes(WORKSPACE_SPEC) ? [WORKSPACE_SPEC] : []), ...folders].map((spec) => ({ value: specKey(spec), spec }));
}

/**
 * Whether a document passes the filter. A query matches the title or path ignoring case, or a server search hit (the
 * full text); `state` `stale` / `missing` keeps that state only; `open` keeps no document (the fog lines stand instead).
 */
export function matches(doc: LibraryDoc, filter: LibraryFilter, hits: SearchHits | null = null): boolean {
  if (filter.state === 'open') return false;
  if (filter.state !== 'all' && doc.state !== filter.state) return false;
  if (filter.type !== 'all' && doc.type !== filter.type) return false;
  if (filter.spec !== 'all' && specKey(doc.spec) !== filter.spec) return false;
  const query = filter.query.trim().toLowerCase();
  if (query === '') return true;
  return hits?.has(doc.path) === true || `${doc.title} ${doc.path}`.toLowerCase().includes(query);
}

/** Whether a spec's evidence subgroup opens on its own: a search runs, or the type filter is `evidence`. */
export const evidenceOpens = (filter: LibraryFilter): boolean => filter.query.trim() !== '' || filter.type === 'evidence';

const workspaceRank = (doc: LibraryDoc): number => {
  const rank = WORKSPACE_ORDER.indexOf(doc.type);
  return rank < 0 ? WORKSPACE_ORDER.length : rank;
};

/**
 * The list: the matching documents of the catalog in groups, workspace-wide first, then the specs ascending, each
 * spec once; a group without a match is left out. Empty under the filter "open" (see `fogGroups`).
 */
export function libraryGroups(catalog: LibraryCatalog, filter: LibraryFilter, hits: SearchHits | null = null): readonly LibraryGroup[] {
  const bySpecFolder = new Map<string, LibraryDoc[]>();
  for (const doc of catalog.docs) {
    if (!matches(doc, filter, hits)) continue;
    const docs = bySpecFolder.get(doc.spec);
    if (docs) docs.push(doc);
    else bySpecFolder.set(doc.spec, [doc]);
  }
  const heads = new Map(catalog.groups.map((head) => [head.spec, head]));
  const open = evidenceOpens(filter);
  return specOptions([...bySpecFolder.values()].flat()).map(({ spec, value }) => {
    const docs = bySpecFolder.get(spec) ?? [];
    const evidence = docs.filter((doc) => doc.type === 'evidence');
    const rows = docs.filter((doc) => doc.type !== 'evidence');
    const ordered =
      spec === WORKSPACE_SPEC
        ? rows.map((doc, at) => ({ doc, at })).sort((a, b) => workspaceRank(a.doc) - workspaceRank(b.doc) || a.at - b.at).map(({ doc }) => doc)
        : [...rows.filter((doc) => doc.state !== 'missing'), ...rows.filter((doc) => doc.state === 'missing')];
    return {
      spec,
      key: value,
      head: heads.get(spec) ?? null,
      docs: ordered,
      evidence: evidence.length === 0 ? null : { docs: evidence, count: evidence.length, open },
      count: docs.length,
    };
  });
}

/**
 * The catalog of one spec's Library area (spec 017, T46, ISC-158; design.md § Across viewports): the documents of
 * the spec the route's ref `spec` names, its missing entries and its evidence included, plus the workspace's
 * constitution; no group head (the spec head above already carries stage, goal and figures); the fog lines of that
 * spec only; and the control counts of the spec's own documents, the constitution outside them. The ref is matched in
 * the three forms the server's `resolveSpec` accepts (number `002`, folder `002-web-console`, slug `web-console`)
 * through core's `specRefMatches`, so every address of the spec lists the same documents.
 */
export function specScope(catalog: LibraryCatalog, spec: string): LibraryCatalog {
  const own = catalog.docs.filter((doc) => doc.spec !== WORKSPACE_SPEC && specRefMatches(doc.spec, spec));
  const constitution = catalog.docs.filter((doc) => doc.spec === WORKSPACE_SPEC && doc.type === 'constitution');
  return {
    docs: [...own, ...constitution],
    groups: [],
    fog: catalog.fog.filter((line) => specRefMatches(line.spec, spec)),
    missing: own.filter((doc) => doc.state === 'missing').length,
    stale: own.filter((doc) => doc.state === 'stale').length,
  };
}

/** The spec area's order (design.md 017, Tablet 2.7): the spec's own group first, the workspace-wide one after it. */
export const specFirst = (groups: readonly LibraryGroup[]): readonly LibraryGroup[] => [
  ...groups.filter((group) => group.spec !== WORKSPACE_SPEC),
  ...groups.filter((group) => group.spec === WORKSPACE_SPEC),
];

/** The revealed part of an evidence subgroup after `blocks` blocks of `EVIDENCE_BLOCK`, and how many still wait. */
export function evidenceBlock(group: EvidenceGroup, blocks: number): { readonly shown: readonly LibraryDoc[]; readonly rest: number } {
  const shown = group.docs.slice(0, Math.max(0, blocks) * EVIDENCE_BLOCK);
  return { shown, rest: group.count - shown.length };
}

/**
 * The filter "open": each spec's `- fog:` lines (core lists only specs that are not complete) under its number,
 * specs ascending, narrowed by the spec filter and, ignoring case, the search text.
 */
export function fogGroups(catalog: LibraryCatalog, filter: LibraryFilter): readonly FogGroup[] {
  const query = filter.query.trim().toLowerCase();
  const bySpecFolder = new Map<string, LibraryFogLine[]>();
  for (const line of catalog.fog) {
    if (filter.spec !== 'all' && specKey(line.spec) !== filter.spec) continue;
    if (query !== '' && !line.text.toLowerCase().includes(query)) continue;
    const lines = bySpecFolder.get(line.spec);
    if (lines) lines.push(line);
    else bySpecFolder.set(line.spec, [line]);
  }
  return [...bySpecFolder.keys()].sort(bySpec).map((spec) => ({ spec, key: specKey(spec), lines: bySpecFolder.get(spec) ?? [] }));
}

/** One run of a highlighted text: `hit` marks the search match (rendered as `<mark>`). */
export interface TextRun {
  readonly text: string;
  readonly hit: boolean;
}

/** `text` split around the first match of `query` (case ignored); one plain run without a query or a match. */
export function highlight(text: string, query: string): readonly TextRun[] {
  const q = query.trim().toLowerCase();
  const at = q === '' ? -1 : text.toLowerCase().indexOf(q);
  if (at < 0) return [{ text, hit: false }];
  return [
    { text: text.slice(0, at), hit: false },
    { text: text.slice(at, at + q.length), hit: true },
    { text: text.slice(at + q.length), hit: false },
  ].filter((run) => run.text !== '');
}
