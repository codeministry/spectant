// The claim view model (T22, ISC-81): the Claims tab's cards with glyph state, kind, dependency edges, probe row and
// verification line, grouped under their feature headings, plus the fog list and the filter counts.
//
// States come from status.ts `partitionClaims`, the same partition the dashboard row counts, so the tab and the row
// agree by construction (ISC-72): closed is a checked claim, dropped a tombstone (checked or not), and an open claim is
// blocked while an edge is unresolved, taken while a lock holds it, else takeable. `open` is not emitted by these rules:
// it stays in the glyph set for an unresolved claim no rule classifies, and `counts.open` is the aggregate of the three
// open states (the spec page's "open").
//
// Pure: spec.md's text and the lock reading in, model out. No file system, no Bun API, no clock; elapsed time since a
// lock is the web's to compute from `since`.
import { parseClaims } from './claims.ts';
import type { FogLine } from './claims.ts';
import type { ClaimGlyphState, ClaimView, ClaimViewCounts, ClaimViewInput, ClaimViewModel, FogView, ProbeRow } from './files.ts';
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
  const partition = partitionClaims(doc.claims, locks);

  const state = new Map<string, ClaimGlyphState>();
  for (const id of partition.takeable) state.set(id, 'takeable');
  for (const t of partition.taken) state.set(t.id, 'taken');
  for (const b of partition.blocked) state.set(b.id, 'blocked');
  for (const id of partition.closed) state.set(id, 'closed');
  for (const id of partition.dropped) state.set(id, 'dropped');
  const blockedBy = new Map(partition.blocked.map((b) => [b.id, b.openBlockers]));
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

  const claims: ClaimView[] = doc.claims.map((c) => {
    const s = state.get(c.id) ?? 'open';
    const lock = s === 'taken' ? lockOf.get(c.id) : undefined;
    return {
      id: c.id,
      text: c.text,
      feature: c.feature,
      state: s,
      kind: c.kind,
      edges: c.after,
      blockedBy: blockedBy.get(c.id) ?? [],
      probe: probes.get(c.id) ?? null,
      verification: verification.get(c.id) ?? null,
      lock: lock ? { source: lock.source, session: lock.session, since: lock.since } : null,
      dropped: c.dropped ? { note: c.droppedNote } : null,
      noteCount: input.noteCounts?.[c.id] ?? 0,
      line: c.line,
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
