// The claim view model (T22, ISC-81): the Claims tab's cards with glyph state, kind, dependency edges, probe row and
// verification line, grouped under their feature headings, plus the fog list and the filter counts.
//
// States come from status.ts `partitionClaims`, the same partition the dashboard row counts, so the tab and the row
// agree by construction (ISC-72): closed is a checked claim, dropped a tombstone (checked or not), and an open claim is
// blocked while an edge is unresolved, taken while a lock holds it, else takeable once the spec's reviewed mark is
// fresh. `open` is the claim the review gate holds (ISC-99: no fresh reviewed mark, so not takeable yet) and any
// unresolved claim no rule classifies; `counts.open` is the aggregate of the four open states (the spec page's "open").
// An open spec edge on the claim (`input.specEdges`, spec 025, ISC-163) turns a takeable or open claim `blocked` with
// `waitsOn`, the specs it waits on: such a claim is never shown takeable. A taken claim stays taken.
//
// The one state model (spec 040, ISC-223): given `input.now`, each claim also carries `itemState`, the item
// item-state.ts `claimStates` derives (open, waiting, running, aborted, done); `taken` and `blocked` are no states of
// their own there (running/aborted on a lock, waiting on an edge), and takeable is the reason of an `open` claim. The
// glyph state stays for the web until it reads `itemState`.
//
// Pure: spec.md's text and the lock reading in, model out. No file system, no Bun API, no clock of its own (`now` is an
// input); elapsed time since a lock is the web's to compute from `since`.
import { parseClaims } from './claims.ts';
import type { FogLine } from './claims.ts';
import type { ClaimGlyphState, ClaimView, ClaimViewCounts, ClaimViewInput, ClaimViewModel, FogView, ProbeRow } from './files.ts';
import { reviewedGate } from './gates.ts';
import { claimStates, DEFAULT_CLAIM_STALE_MS } from './item-state.ts';
import { specIdOf } from './spec-ref.ts';
import { partitionClaims } from './status.ts';

// `<question> — <what must resolve it>`: the first spaced em or en dash splits the two.
const FOG_DASH = /\s+[—–]\s+/;
// A trailing `· since round 2`, `, since R2` or `(since round 2)`.
const FOG_SINCE = /\s*(?:[·,;]\s*)?\(?\s*since\s+(?:round\s*|R)(\d+)\s*\)?\s*$/i;

function fogView(fog: FogLine): FogView {
  const since = FOG_SINCE.exec(fog.text);
  const body = since ? fog.text.slice(0, since.index) : fog.text;
  const dash = FOG_DASH.exec(body);
  return {
    text: (dash ? body.slice(0, dash.index) : body).trim(),
    resolves: dash ? body.slice(dash.index + dash[0].length).trim() || null : null,
    sinceRound: since ? Number(since[1]) : null,
    marks: fog.marks,
    line: fog.line,
  };
}

export function buildClaimViews(input: ClaimViewInput): ClaimViewModel {
  const doc = parseClaims(input.files.texts.spec ?? '');
  const locks = input.locks?.locks ?? [];
  // The review gate from the folder's own texts: without a fresh reviewed mark no claim is takeable (ISC-99).
  const reviewed = reviewedGate(input.files.texts).check.state;
  const partition = partitionClaims(doc.claims, locks, reviewed);

  const state = new Map<string, ClaimGlyphState>();
  for (const id of partition.takeable) state.set(id, 'takeable');
  for (const t of partition.taken) state.set(t.id, 'taken');
  for (const b of partition.blocked) state.set(b.id, 'blocked');
  for (const id of partition.closed) state.set(id, 'closed');
  for (const id of partition.dropped) state.set(id, 'dropped');
  const blockedBy = new Map(partition.blocked.map((b) => [b.id, b.openBlockers]));
  // An open spec edge holds the claim (ISC-163): takeable or open turns blocked; taken, closed and dropped stay.
  const waitsOn = new Map<string, string[]>();
  for (const e of input.specEdges ?? []) {
    if (e.fromKind !== 'claim' || e.state !== 'open') continue;
    const s = state.get(e.fromId) ?? 'open';
    if (s !== 'takeable' && s !== 'open' && s !== 'blocked') continue;
    waitsOn.set(e.fromId, [...new Set([...(waitsOn.get(e.fromId) ?? []), e.toSpec])].sort());
    state.set(e.fromId, 'blocked');
  }
  // Later locks win, as in partitionClaims; only a taken claim shows its lock.
  const lockOf = new Map(locks.map((l) => [l.claim, l]));

  // The first Test Strategy row and the first Verification line of an ID win.
  const probes = new Map<string, ProbeRow>();
  for (const r of doc.testStrategy) {
    if (!probes.has(r.isc)) {
      probes.set(r.isc, { isc: r.isc, type: r.type, check: r.check, threshold: r.threshold, tool: r.tool, anchorsTo: r.anchorsTo, severity: r.severity });
    }
  }
  const verification = new Map<string, string>();
  for (const v of doc.verification) if (!verification.has(v.id)) verification.set(v.id, v.text);

  // The one state model (spec 040, ISC-223): with a clock, each claim carries the item `claimStates` derives from the
  // same claims, locks, review gate and spec edges; the glyph state above stays beside it.
  const now = input.now === undefined ? null : typeof input.now === 'number' ? input.now : input.now.getTime();
  const itemOf = new Map(
    now === null
      ? []
      : claimStates({ spec: specIdOf(input.files.folder) ?? input.files.folder, claims: doc.claims, locks, reviewed, specEdges: input.specEdges ?? [], now, staleAfterMs: input.staleAfterMs ?? DEFAULT_CLAIM_STALE_MS }).map((i) => [i.id, i]),
  );

  const claims: ClaimView[] = doc.claims.map((c) => {
    const s = state.get(c.id) ?? 'open';
    const lock = s === 'taken' ? lockOf.get(c.id) : undefined;
    const itemState = itemOf.get(c.id);
    return {
      id: c.id,
      text: c.text,
      feature: c.feature,
      state: s,
      kind: c.kind,
      edges: c.after,
      afterSpecs: c.afterSpecs,
      blockedBy: blockedBy.get(c.id) ?? [],
      ...(waitsOn.has(c.id) ? { waitsOn: waitsOn.get(c.id) } : {}),
      probe: probes.get(c.id) ?? null,
      verification: verification.get(c.id) ?? null,
      lock: lock ? { source: lock.source, session: lock.session, since: lock.since } : null,
      dropped: c.dropped ? { note: c.droppedNote } : null,
      noteCount: input.noteCounts?.[c.id] ?? 0,
      line: c.line,
      ...(itemState === undefined ? {} : { itemState }),
    };
  });

  const count = (pick: (c: ClaimView) => boolean): number => claims.filter(pick).length;
  const counts: ClaimViewCounts = {
    all: claims.length,
    open: count((c) => c.state === 'open' || c.state === 'takeable' || c.state === 'taken' || c.state === 'blocked'),
    takeable: count((c) => c.state === 'takeable'),
    taken: count((c) => c.state === 'taken'),
    blocked: count((c) => c.state === 'blocked'),
    closed: count((c) => c.state === 'closed'),
    dropped: count((c) => c.state === 'dropped'),
    normal: count((c) => c.kind === 'normal'),
    anti: count((c) => c.kind === 'anti'),
    antecedent: count((c) => c.kind === 'antecedent'),
  };

  return {
    claims,
    features: doc.features.map((f) => ({ id: f.id, title: f.name, why: f.why, claims: f.claims })),
    fog: doc.fog.map(fogView),
    counts,
  };
}
