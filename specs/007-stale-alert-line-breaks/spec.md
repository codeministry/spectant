---
task: "The stale-agent alert breaks like ordinary text in every language"
slug: 007-stale-alert-line-breaks
spec_type: bug
isa_master: ../../ISA.md
isa_feature: F7
constitution: ../constitution.md
phase: scoping
progress: 2/2
started: 2026-10-11T08:00:00Z
updated: 2026-10-11T08:31:49Z
context_sufficient: true
interview_invoked: false
context_log: context.md
---

<!-- SPEC — a derived view of ../../ISA.md (feature F7, claims ISC-115 to ISC-115.2). Claim IDs belong to the master,
     which is untracked in this public repository; every claim here carries its full text so this file reads on its
     own. Sync: Skill("Spec", "sync 007-stale-alert-line-breaks"). Never edit the master from this file.
     principal_stated_goal is deliberately absent: it is German and lives only in the untracked master
     (../constitution.md § What a spec may contain). -->

# 007 — Line breaks in the stale-agent alert

## Problem

Spec 002 renders the board rail's stale-agent alert ("No release from `<session>` on `<claims>`: the agent may have
stopped.") from one translated sentence: `alertParts` in
`web/src/app/features/spec/live/this-frame/needs-you.ts` splits it at the `{{session}}` and `{{claims}}` placeholders
and renders the session and each claim id as an inline-block run that stays whole. Two defects remain from that
spec's close review, and a third was raised there:

- **Opening punctuation before an id.** An inline-block run is a break chance on both sides. A translation with an
  opening bracket or quote right before a placeholder (`({{claims}})`, `„{{session}}“`) can end a line with `(` or `„`
  and start the next one with the id.
- **Too much glued after an id.** `glue` moves every `\p{P}` that follows an id into its run: an opening bracket, a
  dash or an apostrophe after an id (`{{session}}-session`, `{{session}}'s`) becomes part of the unbreakable run.
- **An empty claims list.** `Intl.ListFormat` of an empty list yields no parts, so a stale agent without claims
  would render "No release from `<session>` on : the agent may have stopped." Core never builds such an agent (every
  live agent comes from a lock), so ISC-115.2 was dropped at code review.

**Reproduction.** In the unit test of `this-frame.spec.ts`, call `alertParts` with the sentence
`(\u0001session\u0001) on \u0001claims\u0001.`: the `(` stays at the end of the text part before the session, so a line
can end with it.

## Out of Scope

- **The points of the review that change no behaviour.** Shared stub constants in `board.spec.ts`, one chip-centre
  helper, one `--rail-target` token, one line height on `.row`: a separate refactor.
- **Probe coverage of the rail guards.** Filing `overflow at 1440`, `rail text`, `rail sheet` and the coarse test
  under a claim's probe belongs to that refactor too.
- **Every other rail row text.** This frame and Needs you rows already wrap (spec 002); only the alert sentence is in
  scope.

## Goal

The stale-agent alert breaks like ordinary text in every language: no line starts with closing punctuation or ends
with opening punctuation. (The goal confirmed at the lock also named an empty claims list; that case cannot occur, see
`## Decisions`.)

## Claims

- [x] ISC-115: In the stale-agent alert the run of an id is the whole token that contains it, a token being what lies between breakable white space (a no-break space joins, as it does in layout) — the id with any punctuation or letters touching it, such as `(ISC-74),` or `spec-1-session`, and ids that share a token, such as `spec-1/ISC-2`, share one run — so the alert breaks only at spaces, like ordinary text, and never inside an id's token, whatever the language's punctuation classes.
- [x] ISC-115.1: Anti: a line of the stale-agent alert starts or ends with a mark that touches an id — an opening bracket or quote before an id, or a closing bracket, quote or terminal mark after it, the German „…“ and the apostrophe ’ included. (after: ISC-115)
- [ ] ISC-115.2: [DROPPED — see Decisions 2026-10-11] Anti: a stale agent with an empty claims list renders a sentence with a gap where the claims would be.

## Test Strategy

| isc | type | check | threshold | tool | anchors_to | severity |
|---|---|---|---|---|---|---|
| ISC-115 | bun-test | `alertParts` on sentences where `(`, `„…“`, `-session`, `’s`, `,`, `:`, a `/` between two ids and no-break spaces touch an id, in en and de | every run is exactly one token of the joined sentence split at breakable white space; ids sharing a token share a run; text next to a run starts or ends with breakable white space; the parts join back to the sentence | `bun run --cwd web test -- --filter "token rule"` | derived: spec 002 close review, points 1 and 2 | medium |
| ISC-115.1 | bun-test | `alertParts` on `„{{session}}“ ({{claims}}).` and `{{session}}’s {{claims}}` in en and de | `„` and `(` open the ids' runs, `“`, `).` and `’s` close them; no text part ends with an opening mark (`\p{Ps}`, `\p{Pi}`) or starts with a closing or terminal one (`\p{Pe}`, `\p{Pf}`, `\p{Po}`) | `bun run --cwd web test -- --filter "touching marks"` | derived: spec 002 close review, point 1 | medium |

## Decisions

- **2026-10-11 — the goal lock.** The alert breaks like ordinary text in every language, empty claims list included,
  over "only the empty list" and "every rail row text". The points of spec 002's close review that change no
  behaviour, and the probe coverage of the rail guards, stay for a separate refactor.

- **2026-10-11 — refined during implement (principal).** An id's run is the whitespace-delimited token that
  contains it, over a rule by Unicode punctuation class: the German closing quote “ is `\p{Pi}` and the apostrophe ’
  is `\p{Pf}`, so a class rule mis-sorts both, while text breaks at spaces in every language anyway.

- **2026-10-11 — refined and dropped at code review (principal).** ISC-115: tokens end only at breakable white space
  (a no-break space joins, as it does in layout) and ids that share a token share one run. ISC-115.2 is dropped:
  core builds every live agent from a lock (`agentsOf` in `core/src/live.ts`), so a stale agent always holds at least
  one claim; the guard, its catalogue key and its test went with it. ISC-115.1 is now phrased as the anti-claim (same
  assertion, `Anti:` prefix).

## Verification

- ISC-115: bun-test — bun run --cwd web test -- --filter "token rule" → exit 0, 1 pass (2026-10-11); red first with an inert head field before the token rule; the shared-token and no-break-space cases were added at code review and not re-observed red against the earlier rule; web lane 516 pass, board e2e 50 pass, board visual unchanged both themes
- ISC-115.1: bun-test — bun run --cwd web test -- --filter "touching marks" → exit 0, 1 pass in en and de (2026-10-11); red first with an inert head field before the token rule
- ISC-115.2: dropped 2026-10-11 (see Decisions); its probe had passed once on a no-claims catalogue key, removed with the claim
