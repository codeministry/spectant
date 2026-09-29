// The notes contract (T94, ISC-94, ISC-95): a note carries its workspace and at most one anchor, the validators refuse
// everything else with a kebab-case code from the inventory, the builders and the matcher agree on every route, the
// anchor maps onto one set of columns and back, and the per-anchor counts answer the Claims tab's badge.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { API_ERRORS, SPEC_API_ROOT } from "../server/src/spec-routes.contract.ts";
import {
  ANCHOR_KINDS,
  NOTE_ERRORS,
  NOTE_ROUTE_TABLE,
  NOTE_VALIDATION_ERRORS,
  type Note,
  type NoteAnchor,
  type NoteCounts,
  anchorColumns,
  anchorFromColumns,
  isNoteId,
  isWorkspaceSlug,
  matchNoteRoute,
  noteAllowFor,
  noteCountFor,
  noteRoutes,
  parseAnchor,
  parseNewNote,
  parseNoteCountsQuery,
  parseNoteDraft,
  parseNotesQuery,
  validateNote,
} from "../server/src/notes.contract.ts";

const ID = "3f2b8c1e-4a5d-4e6f-9a7b-1c2d3e4f5a6b";
const NOW = "2026-09-29T10:00:00.000Z";
const ANCHORS: readonly NoteAnchor[] = [
  { kind: "spec", spec: "002" },
  { kind: "claim", spec: "002", id: "ISC-94" },
  { kind: "task", spec: "002", id: "T95" },
];

function note(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: ID, workspace: "leadgen", anchor: null, title: "", body: "Remember the index.", created: NOW, updated: NOW, ...overrides };
}

function codeOf(check: { ok: boolean; error?: string }): string | undefined {
  return check.ok ? undefined : check.error;
}

describe("the note shape", () => {
  test("a note with no anchor is valid", () => {
    const check = validateNote(note());
    expect(check.ok).toBe(true);
    if (check.ok) expect(check.value.anchor).toBeNull();
  });

  test("a note with exactly one anchor of each kind is valid, and the kinds are spec, claim and task", () => {
    expect([...ANCHOR_KINDS]).toEqual(["spec", "claim", "task"]);
    for (const anchor of ANCHORS) {
      const check = validateNote(note({ anchor }));
      expect(check.ok).toBe(true);
      if (check.ok) expect(check.value.anchor).toEqual(anchor);
    }
  });

  test("two anchors are refused, as a list or as a second field", () => {
    expect(codeOf(validateNote(note({ anchor: [ANCHORS[0], ANCHORS[1]] })))).toBe("multiple-anchors");
    expect(codeOf(validateNote(note({ anchors: [ANCHORS[1]] })))).toBe("multiple-anchors");
    expect(codeOf(parseNoteDraft({ body: "x", anchor: ANCHORS[1], anchors: [ANCHORS[2]] }))).toBe("multiple-anchors");
    expect(codeOf(parseAnchor([ANCHORS[2]]))).toBe("multiple-anchors");
  });

  test("an anchor that names a second target, a wrong kind or a malformed ref is refused", () => {
    const bad: unknown[] = [
      { kind: "spec", spec: "002", id: "ISC-94" }, // a spec anchor has no id
      { kind: "claim", spec: "002" }, // a claim anchor needs its id
      { kind: "task", spec: "002", id: "ISC-94", claim: "ISC-1" }, // an extra key is a second target
      { kind: "file", spec: "002" },
      { kind: "claim", spec: "002-shell", id: "ISC-94" }, // the canonical NNN id only
      { kind: "claim", spec: "002", id: "../ISC-94" },
      { kind: "task", spec: "002", id: "" },
      "ISC-94",
    ];
    for (const anchor of bad) expect(codeOf(parseAnchor(anchor))).toBe("invalid-anchor");
  });

  test("a missing or non-slug workspace is refused; null marks an orphan of a removed workspace", () => {
    const withoutWorkspace = note();
    delete withoutWorkspace.workspace;
    expect(codeOf(validateNote(withoutWorkspace))).toBe("invalid-workspace");
    for (const workspace of ["", ".", "..", "a/b", "a\\b", "tab\there", 7]) {
      expect(codeOf(validateNote(note({ workspace })))).toBe("invalid-workspace");
    }
    expect(validateNote(note({ workspace: null })).ok).toBe(true);
    expect(isWorkspaceSlug("leadgen-2")).toBe(true);
    expect(isWorkspaceSlug("my.repo")).toBe(true);
  });

  test("an empty or blank body is refused", () => {
    for (const body of ["", "   ", "\n\t"]) expect(codeOf(validateNote(note({ body })))).toBe("empty-body");
    expect(codeOf(parseNoteDraft({ body: " " }))).toBe("empty-body");
    expect(codeOf(parseNoteDraft({}))).toBe("empty-body");
  });

  test("ids, titles and timestamps are checked", () => {
    expect(isNoteId(ID)).toBe(true);
    expect(isNoteId("counts")).toBe(false);
    expect(codeOf(validateNote(note({ id: "note-1" })))).toBe("invalid-id");
    expect(codeOf(validateNote(note({ title: 7 })))).toBe("invalid-title");
    expect(codeOf(validateNote(note({ title: "x".repeat(201) })))).toBe("invalid-title");
    expect(codeOf(validateNote(note({ created: "yesterday" })))).toBe("invalid-body");
  });

  test("a note carries no path: the only keys are the contract's, so nothing points into a repository", () => {
    const check = validateNote(note({ anchor: ANCHORS[1] }));
    expect(check.ok).toBe(true);
    if (check.ok) expect(Object.keys(check.value).sort()).toEqual(["anchor", "body", "created", "id", "title", "updated", "workspace"]);
    expect(codeOf(validateNote(note({ path: "/repo/specs/002" })))).toBe("invalid-body");
  });
});

describe("request bodies", () => {
  test("a draft defaults to no anchor and an empty title, and trims the title", () => {
    const check = parseNoteDraft({ body: "text", title: "  Idea  " });
    expect(check).toEqual({ ok: true, value: { anchor: null, title: "Idea", body: "text" } });
  });

  test("a non-object body or an unknown key is invalid-body", () => {
    for (const body of [null, "text", [], 3]) expect(codeOf(parseNoteDraft(body))).toBe("invalid-body");
    expect(codeOf(parseNoteDraft({ body: "x", workspace: "other" }))).toBe("invalid-body");
    expect(codeOf(parseNoteDraft({ body: "x", id: ID }))).toBe("invalid-body");
  });

  test("a new note takes its workspace from the path, which must be a slug", () => {
    const anchor: NoteAnchor = { kind: "task", spec: "002", id: "T95" };
    expect(parseNewNote("leadgen", { body: "x", anchor })).toEqual({
      ok: true,
      value: { workspace: "leadgen", anchor, title: "", body: "x" },
    });
    expect(codeOf(parseNewNote(undefined, { body: "x" }))).toBe("invalid-workspace");
    expect(codeOf(parseNewNote("a/b", { body: "x" }))).toBe("invalid-workspace");
  });
});

describe("queries", () => {
  test("the list query filters by spec, claim or task, or by unanchored or orphaned notes", () => {
    expect(parseNotesQuery("")).toEqual({ ok: true, value: {} });
    expect(parseNotesQuery("?spec=002")).toEqual({ ok: true, value: { spec: "002" } });
    expect(parseNotesQuery("?spec=002&claim=ISC-94")).toEqual({ ok: true, value: { spec: "002", claim: "ISC-94" } });
    expect(parseNotesQuery(new URLSearchParams("spec=002&task=T95"))).toEqual({ ok: true, value: { spec: "002", task: "T95" } });
    expect(parseNotesQuery("?unanchored=1")).toEqual({ ok: true, value: { unanchored: true } });
    expect(parseNotesQuery("?orphans=1")).toEqual({ ok: true, value: { orphans: true } });
  });

  test("a claim or task without its spec, both at once, a bad value or an unknown key is invalid-query", () => {
    for (const q of ["?claim=ISC-94", "?task=T1", "?spec=002&claim=ISC-1&task=T1", "?spec=2", "?spec=002&unanchored=1", "?orphans=yes", "?page=2", "?spec=002&spec=003"]) {
      expect(codeOf(parseNotesQuery(q))).toBe("invalid-query");
    }
  });

  test("the counts query names exactly one spec", () => {
    expect(parseNoteCountsQuery("?spec=002")).toEqual({ ok: true, value: { spec: "002" } });
    for (const q of ["", "?spec=", "?spec=002&claim=ISC-1"]) expect(codeOf(parseNoteCountsQuery(q))).toBe("invalid-query");
  });
});

describe("routes", () => {
  const root = `${SPEC_API_ROOT}/leadgen`;

  test("builders encode each segment once and write the query in a stable order", () => {
    expect(noteRoutes.list("leadgen")).toBe(`${root}/notes`);
    expect(noteRoutes.list("leadgen", { spec: "002", claim: "ISC-94" })).toBe(`${root}/notes?spec=002&claim=ISC-94`);
    expect(noteRoutes.list("leadgen", { orphans: true })).toBe(`${root}/notes?orphans=1`);
    expect(noteRoutes.create("my repo")).toBe(`${SPEC_API_ROOT}/my%20repo/notes`);
    expect(noteRoutes.update("leadgen", ID)).toBe(`${root}/notes/${ID}`);
    expect(noteRoutes.remove("leadgen", ID)).toBe(`${root}/notes/${ID}`);
    expect(noteRoutes.counts("leadgen", "002")).toBe(`${root}/note-counts?spec=002`);
  });

  test("every builder round-trips through the matcher with its method", () => {
    const cases = [
      [noteRoutes.list("my repo"), "GET", { route: "list", params: { ws: "my repo" } }],
      [noteRoutes.list("leadgen"), "HEAD", { route: "list", params: { ws: "leadgen" } }],
      [noteRoutes.create("leadgen"), "POST", { route: "create", params: { ws: "leadgen" } }],
      [noteRoutes.update("leadgen", ID), "PUT", { route: "update", params: { ws: "leadgen", id: ID } }],
      [noteRoutes.remove("leadgen", ID), "DELETE", { route: "remove", params: { ws: "leadgen", id: ID } }],
      [new URL(noteRoutes.counts("leadgen", "002"), "http://127.0.0.1").pathname, "GET", { route: "counts", params: { ws: "leadgen" } }],
    ] as const;
    for (const [path, method, expected] of cases) expect(matchNoteRoute(path.split("?")[0] ?? "", method)).toEqual(expected);
  });

  test("a wrong method is no route but has an Allow header; a foreign path has neither", () => {
    expect(matchNoteRoute(`${root}/notes`, "DELETE")).toBeNull();
    expect(noteAllowFor(`${root}/notes`)).toBe("GET, HEAD, POST");
    expect(noteAllowFor(`${root}/notes/${ID}`)).toBe("PUT, DELETE");
    expect(noteAllowFor(`${root}/note-counts`)).toBe("GET, HEAD");
    expect(noteAllowFor(`${root}/specs/002`)).toBeNull();
    expect(matchNoteRoute(`${root}/notes/${ID}/extra`, "PUT")).toBeNull();
    expect(matchNoteRoute(`${SPEC_API_ROOT}/%E0%A4%A/notes`, "GET")).toBeNull();
  });

  test("the table lists every route once, under the workspace root, with ascending statuses", () => {
    expect(NOTE_ROUTE_TABLE.map((entry) => entry.route)).toEqual(["list", "create", "update", "remove", "counts"]);
    for (const entry of NOTE_ROUTE_TABLE) {
      expect(entry.pattern.startsWith(`${SPEC_API_ROOT}/:ws/`)).toBe(true);
      expect([...entry.statuses]).toEqual([...entry.statuses].sort((a, b) => a - b));
      expect(entry.statuses).toContain(403);
      expect(entry.statuses).toContain(404);
    }
  });
});

describe("error inventory", () => {
  test("every code is kebab-case, route codes come from the API inventory, validation codes answer 400", () => {
    for (const code of NOTE_ERRORS) expect(code).toMatch(/^[a-z]+(-[a-z]+)*$/);
    expect(new Set(NOTE_ERRORS).size).toBe(NOTE_ERRORS.length);
    for (const code of ["not-found", "forbidden", "method-not-allowed", "invalid-body"] as const) {
      expect(API_ERRORS).toContain(code);
      expect(NOTE_ERRORS).toContain(code);
    }
    for (const code of NOTE_VALIDATION_ERRORS) expect(NOTE_ERRORS).toContain(code);
  });

  test("every refusal a validator returns is listed in the inventory", () => {
    const refusals = [
      validateNote(null),
      validateNote(note({ workspace: "" })),
      validateNote(note({ anchor: 1 })),
      validateNote(note({ anchor: [1, 2] })),
      validateNote(note({ body: "" })),
      validateNote(note({ id: 1 })),
      validateNote(note({ title: 1 })),
      parseNotesQuery("?x=1"),
    ];
    for (const check of refusals) {
      expect(check.ok).toBe(false);
      expect(NOTE_VALIDATION_ERRORS).toContain(codeOf(check) as (typeof NOTE_VALIDATION_ERRORS)[number]);
    }
  });
});

describe("storage mapping and counts", () => {
  test("an anchor maps onto one set of columns and back, so a row cannot hold two", () => {
    expect(anchorColumns(null)).toEqual({ anchor_kind: null, anchor_spec: null, anchor_id: null });
    for (const anchor of ANCHORS) {
      const columns = anchorColumns(anchor);
      expect(anchorFromColumns(columns.anchor_kind, columns.anchor_spec, columns.anchor_id)).toEqual(anchor);
    }
    expect(anchorFromColumns(null, null, null)).toBeNull();
    expect(() => anchorFromColumns("spec", "002", "ISC-1")).toThrow();
    expect(() => anchorFromColumns(null, "002", null)).toThrow();
  });

  test("the per-anchor counts answer the Claims tab's badge, own keys only", () => {
    const counts: NoteCounts = { spec: "002", total: 4, onSpec: 1, claims: { "ISC-94": 2 }, tasks: { T95: 1 } };
    expect(noteCountFor(counts, { kind: "claim", spec: "002", id: "ISC-94" })).toBe(2);
    expect(noteCountFor(counts, { kind: "claim", spec: "002", id: "ISC-95" })).toBe(0);
    expect(noteCountFor(counts, { kind: "claim", spec: "002", id: "constructor" })).toBe(0);
    expect(noteCountFor(counts, { kind: "task", spec: "002", id: "T95" })).toBe(1);
    expect(noteCountFor(counts, { kind: "spec", spec: "002" })).toBe(1);
    expect(noteCountFor(counts, { kind: "claim", spec: "003", id: "ISC-94" })).toBe(0);
  });
});

test("the module stays browser-safe: its only import is the spec routes contract", () => {
  const source = readFileSync(join(import.meta.dir, "../server/src/notes.contract.ts"), "utf8");
  const imports = [...source.matchAll(/^import .* from ['"](.+)['"];$/gm)].map((match) => match[1]);
  expect(imports).toEqual(["./spec-routes.contract.ts"]);
  const typed: Note = { id: ID, workspace: "leadgen", anchor: null, title: "", body: "x", created: NOW, updated: NOW };
  expect(validateNote(typed).ok).toBe(true);
});
