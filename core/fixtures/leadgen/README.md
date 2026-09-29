# core/fixtures/leadgen

A frozen copy of three public specs from [codeministry/leadgen](https://github.com/codeministry/leadgen), under
Apache-2.0 (`LICENSE-leadgen.txt`). Unlike `harbor/`, `lantern/` and `empty-master/`, this tree is real: it pins the
parser against specs a working repository wrote, not against specs written to fit the parser.

- **Source commit:** `20c39e4`
- **Frozen on:** 2026-09-29
- **Refresh:** never in place. A newer leadgen spec is a new freeze with a new commit here, together with the golden
  snapshot it changes.

## The specs

| Spec | Type · phase | `isa_feature` | Carries |
|------|--------------|---------------|---------|
| `012-pwa-install` | feature · building | F40 | 9 of 10 claims closed, one fog line, `rounds.jsonl`, a reviewed mark |
| `archive/013-tech-debt` | refactor · complete | F41 | `archived:` date, `## Claims` in place of a feature block, one claim `[DROPPED]` and open, `rounds.jsonl`, no gate marks |
| `022-chat-turn-status-and-bulk-delete` | feature · complete | F50 | every claim closed, `rounds.jsonl`, a reviewed and a code-reviewed mark |

Copied per spec: `spec.md`, `plan.md`, `tasks.md`, `context.md`, `rounds.jsonl` and `.gates/*.json`, byte for byte
from the source path (none of the three has a `design.md`). Left out: the rendered pages (`*.html`, `*.version.js`),
`.vendor/` and the German translations under `.i18n/`. `specs/constitution.md` is leadgen's own.

One change against the source: the code-reviewed mark of 022 held the absolute path of the machine it was written on
in `root`; that value is now the placeholder `<leadgen-root>`. Its `tree` and `head` match no working tree here, so
the mark reads as stale, like harbor's.

## The master

leadgen's `ISA.md` is private and was not read. `ISA.md` here is rebuilt from the three specs alone: one
`### F<n> · <name>` block per spec's `isa_feature` holding exactly the claims that spec carries (same IDs, text,
state and `(after: …)` edges), and the specs' own Test Strategy rows. IDs keep their original numbers, because
fixtures never share a master. `progress` counts every claim line, so the dropped ISC-342 counts as open: 31/33.
