---
task: "Mirror container manifests between registries with Harbor"
slug: 20260302-harbor
project: harbor
phase: climbing
progress: 101/124
started: 2026-03-02T08:00:00Z
updated: 2026-03-09T17:30:00Z
---

# Harbor

## Problem

Teams that build on public base images pull them from registries they do not control. When an upstream tag moves or
a registry rate-limits, builds break in ways nobody can reproduce. Copying images by hand is slow, easy to get wrong,
and leaves no record of what was copied when.

## Vision

One command, `harbor sync`, mirrors every manifest a team depends on into its own registry, byte for byte, and running
it again is a no-op. A small web console shows what was mirrored and what failed, and retention policies keep the
mirror from growing without bound.

## Out of Scope

- Building images. Harbor copies what exists; it never runs a build.
- A hosted service. Harbor runs where the team runs it.

## Principles

- A manifest is either fully present in the target or not at all.
- The registry is the truth; Harbor's own state is a cache that can be rebuilt.

## Constraints

- Bun and TypeScript for the CLI, the API and the console.
- No credential is ever written to a log, an error or the history.

## Goal

A team lists its upstream images once, runs `harbor sync` on a schedule, and every build pulls from its own registry
with identical digests, while the console shows each run and retention keeps the mirror bounded.

## Not yet specified

- fog: which config format version 2 uses — the spike in spec 005 has to name the trade-off first
- fog: whether a policy file may include another — depends on the config format decision

## Test Strategy

| isc | type | check | threshold | tool | anchors_to | severity |
|-----|------|-------|-----------|------|------------|----------|
| ISC-1 | bun-test | target registry after an interrupted push | 0 partial manifests | `bun test tests/push.test.ts -t "interrupted"` | derived: atomic-push | high |
| ISC-2 | bash | exit code of a run with one failing repository | non-zero | `bun run cli -- sync --config tests/one-fails.toml; test $? -ne 0` | literal |  |
| ISC-3 | bun-test | credential canaries in every output channel | 0 hits | `bun test tests/redaction.test.ts` | derived: no-leak | high |
| ISC-4 | bun-test | listen address without and with `--listen` | 2 cases | `bun test tests/listen.test.ts` | derived: local-first |  |
| ISC-5 | bun-test | digest equality for case 1 | equal | `bun test tests/sync.test.ts -t "case 5"` | literal | high |
| ISC-6 | bun-test | digest equality for case 2 | equal | `bun test tests/sync.test.ts -t "case 6"` | literal |  |
| ISC-7 | bun-test | digest equality for case 3 | equal | `bun test tests/sync.test.ts -t "case 7"` | literal |  |
| ISC-8 | bun-test | digest equality for case 4 | equal | `bun test tests/sync.test.ts -t "case 8"` | literal |  |
| ISC-9 | bun-test | digest equality for case 5 | equal | `bun test tests/sync.test.ts -t "case 9"` | literal |  |
| ISC-10 | bun-test | digest equality for case 6 | equal | `bun test tests/sync.test.ts -t "case 10"` | literal |  |
| ISC-11 | bun-test | digest equality for case 7 | equal | `bun test tests/sync.test.ts -t "case 11"` | literal |  |
| ISC-12 | bun-test | digest equality for case 8 | equal | `bun test tests/sync.test.ts -t "case 12"` | literal |  |
| ISC-13 | bun-test | digest equality for case 9 | equal | `bun test tests/sync.test.ts -t "case 13"` | literal |  |
| ISC-14 | bun-test | digest equality for case 10 | equal | `bun test tests/sync.test.ts -t "case 14"` | literal | high |
| ISC-15 | bun-test | digest equality for case 11 | equal | `bun test tests/sync.test.ts -t "case 15"` | literal |  |
| ISC-16 | bun-test | digest equality for case 12 | equal | `bun test tests/sync.test.ts -t "case 16"` | literal |  |
| ISC-17 | bash | dry-run writes for case 1 | 0 writes | `bun run cli -- sync --dry-run --case 1 \| rg -c PUSH` | literal |  |
| ISC-18 | bash | dry-run writes for case 2 | 0 writes | `bun run cli -- sync --dry-run --case 2 \| rg -c PUSH` | literal |  |
| ISC-19 | bash | dry-run writes for case 3 | 0 writes | `bun run cli -- sync --dry-run --case 3 \| rg -c PUSH` | literal |  |
| ISC-20 | bash | dry-run writes for case 4 | 0 writes | `bun run cli -- sync --dry-run --case 4 \| rg -c PUSH` | literal |  |
| ISC-21 | bash | dry-run writes for case 5 | 0 writes | `bun run cli -- sync --dry-run --case 5 \| rg -c PUSH` | literal |  |
| ISC-22 | bash | dry-run writes for case 6 | 0 writes | `bun run cli -- sync --dry-run --case 6 \| rg -c PUSH` | literal |  |
| ISC-23 | bash | dry-run writes for case 7 | 0 writes | `bun run cli -- sync --dry-run --case 7 \| rg -c PUSH` | literal | high |
| ISC-24 | bash | dry-run writes for case 8 | 0 writes | `bun run cli -- sync --dry-run --case 8 \| rg -c PUSH` | literal |  |
| ISC-25 | bash | dry-run writes for case 9 | 0 writes | `bun run cli -- sync --dry-run --case 9 \| rg -c PUSH` | literal |  |
| ISC-26 | bash | dry-run writes for case 10 | 0 writes | `bun run cli -- sync --dry-run --case 10 \| rg -c PUSH` | literal |  |
| ISC-27 | bash | dry-run writes for case 11 | 0 writes | `bun run cli -- sync --dry-run --case 11 \| rg -c PUSH` | literal |  |
| ISC-28 | bash | dry-run writes for case 12 | 0 writes | `bun run cli -- sync --dry-run --case 12 \| rg -c PUSH` | literal |  |
| ISC-29 | bun-test | bytes uploaded on re-run for case 1 | 0 bytes | `bun test tests/sync.test.ts -t "case 29"` | derived: idempotent-sync |  |
| ISC-30 | bun-test | bytes uploaded on re-run for case 2 | 0 bytes | `bun test tests/sync.test.ts -t "case 30"` | derived: idempotent-sync |  |
| ISC-31 | bun-test | bytes uploaded on re-run for case 3 | 0 bytes | `bun test tests/sync.test.ts -t "case 31"` | derived: idempotent-sync |  |
| ISC-32 | bun-test | bytes uploaded on re-run for case 4 | 0 bytes | `bun test tests/sync.test.ts -t "case 32"` | derived: idempotent-sync | high |
| ISC-33 | bun-test | bytes uploaded on re-run for case 5 | 0 bytes | `bun test tests/sync.test.ts -t "case 33"` | derived: idempotent-sync |  |
| ISC-34 | bun-test | bytes uploaded on re-run for case 6 | 0 bytes | `bun test tests/sync.test.ts -t "case 34"` | derived: idempotent-sync |  |
| ISC-35 | bun-test | bytes uploaded on re-run for case 7 | 0 bytes | `bun test tests/sync.test.ts -t "case 35"` | derived: idempotent-sync |  |
| ISC-36 | bun-test | bytes uploaded on re-run for case 8 | 0 bytes | `bun test tests/sync.test.ts -t "case 36"` | derived: idempotent-sync |  |
| ISC-37 | bun-test | bytes uploaded on re-run for case 9 | 0 bytes | `bun test tests/sync.test.ts -t "case 37"` | derived: idempotent-sync |  |
| ISC-38 | bun-test | bytes uploaded on re-run for case 10 | 0 bytes | `bun test tests/sync.test.ts -t "case 38"` | derived: idempotent-sync |  |
| ISC-39 | bun-test | bytes uploaded on re-run for case 11 | 0 bytes | `bun test tests/sync.test.ts -t "case 39"` | derived: idempotent-sync |  |
| ISC-40 | bun-test | bytes uploaded on re-run for case 12 | 0 bytes | `bun test tests/sync.test.ts -t "case 40"` | derived: idempotent-sync |  |
| ISC-41 | bun-test | log line fields for case 1 | source and target named | `bun test tests/sync.test.ts -t "case 41"` | literal | high |
| ISC-42 | bun-test | log line fields for case 2 | source and target named | `bun test tests/sync.test.ts -t "case 42"` | literal |  |
| ISC-43 | bun-test | log line fields for case 3 | source and target named | `bun test tests/sync.test.ts -t "case 43"` | literal |  |
| ISC-44 | bun-test | log line fields for case 4 | source and target named | `bun test tests/sync.test.ts -t "case 44"` | literal |  |
| ISC-45 | bun-test | log line fields for case 5 | source and target named | `bun test tests/sync.test.ts -t "case 45"` | literal |  |
| ISC-46 | bun-test | log line fields for case 6 | source and target named | `bun test tests/sync.test.ts -t "case 46"` | literal |  |
| ISC-47 | bun-test | log line fields for case 7 | source and target named | `bun test tests/sync.test.ts -t "case 47"` | literal |  |
| ISC-48 | bun-test | log line fields for case 8 | source and target named | `bun test tests/sync.test.ts -t "case 48"` | literal |  |
| ISC-49 | bun-test | log line fields for case 9 | source and target named | `bun test tests/sync.test.ts -t "case 49"` | literal |  |
| ISC-50 | bun-test | log line fields for case 10 | source and target named | `bun test tests/sync.test.ts -t "case 50"` | literal | high |
| ISC-51 | e2e | registry-list: renders | 0 console errors | `bun run e2e -- registry-list -g render` | derived: console-usable | high |
| ISC-52 | e2e | repository-view: renders | 0 console errors | `bun run e2e -- repository-view -g render` | derived: console-usable |  |
| ISC-53 | e2e | tag-table: renders | 0 console errors | `bun run e2e -- tag-table -g render` | derived: console-usable |  |
| ISC-54 | e2e | digest-detail-panel: renders | 0 console errors | `bun run e2e -- digest-detail-panel -g render` | derived: console-usable |  |
| ISC-55 | e2e | sync-history: renders | 0 console errors | `bun run e2e -- sync-history -g render` | derived: console-usable |  |
| ISC-56 | e2e | settings-page: renders | 0 console errors | `bun run e2e -- settings-page -g render` | derived: console-usable |  |
| ISC-57 | e2e | search-box: renders | 0 console errors | `bun run e2e -- search-box -g render` | derived: console-usable |  |
| ISC-58 | e2e | empty-state: renders | 0 console errors | `bun run e2e -- empty-state -g render` | derived: console-usable |  |
| ISC-59 | e2e | error-banner: renders | 0 console errors | `bun run e2e -- error-banner -g render` | derived: console-usable |  |
| ISC-60 | e2e | theme-switch: renders | 0 console errors | `bun run e2e -- theme-switch -g render` | derived: console-usable |  |
| ISC-60.1 | e2e | theme-switch: follows the system scheme | 2 cases | `bun run e2e -- theme-switch -g system` | literal |  |
| ISC-60.2 | e2e | theme-switch: mode survives reload | 2 cases | `bun run e2e -- theme-switch -g persist` | literal |  |
| ISC-61 | e2e | tag-table: no overflow at 390 px | scrollWidth == clientWidth | `bun run e2e -- tag-table -g narrow` | derived: small-screens |  |
| ISC-62 | e2e | digest-detail-panel: no overflow at 390 px | scrollWidth == clientWidth | `bun run e2e -- digest-detail-panel -g narrow` | derived: small-screens |  |
| ISC-63 | e2e | sync-history: no overflow at 390 px | scrollWidth == clientWidth | `bun run e2e -- sync-history -g narrow` | derived: small-screens |  |
| ISC-64 | e2e | settings-page: no overflow at 390 px | scrollWidth == clientWidth | `bun run e2e -- settings-page -g narrow` | derived: small-screens |  |
| ISC-65 | e2e | search-box: no overflow at 390 px | scrollWidth == clientWidth | `bun run e2e -- search-box -g narrow` | derived: small-screens |  |
| ISC-66 | e2e | empty-state: no overflow at 390 px | scrollWidth == clientWidth | `bun run e2e -- empty-state -g narrow` | derived: small-screens |  |
| ISC-67 | e2e | error-banner: no overflow at 390 px | scrollWidth == clientWidth | `bun run e2e -- error-banner -g narrow` | derived: small-screens |  |
| ISC-68 | e2e | theme-switch: no overflow at 390 px | scrollWidth == clientWidth | `bun run e2e -- theme-switch -g narrow` | derived: small-screens |  |
| ISC-69 | browser | registry-list: keyboard reach and focus ring | all reachable | `bun run test:browser -- registry-list` | derived: console-usable |  |
| ISC-70 | browser | repository-view: keyboard reach and focus ring | all reachable | `bun run test:browser -- repository-view` | derived: console-usable |  |
| ISC-71 | browser | tag-table: keyboard reach and focus ring | all reachable | `bun run test:browser -- tag-table` | derived: console-usable |  |
| ISC-72 | browser | digest-detail-panel: keyboard reach and focus ring | all reachable | `bun run test:browser -- digest-detail-panel` | derived: console-usable |  |
| ISC-73 | browser | sync-history: keyboard reach and focus ring | all reachable | `bun run test:browser -- sync-history` | derived: console-usable |  |
| ISC-74 | browser | settings-page: keyboard reach and focus ring | all reachable | `bun run test:browser -- settings-page` | derived: console-usable |  |
| ISC-75 | browser | search-box: keyboard reach and focus ring | all reachable | `bun run test:browser -- search-box` | derived: console-usable |  |
| ISC-76 | browser | empty-state: keyboard reach and focus ring | all reachable | `bun run test:browser -- empty-state` | derived: console-usable |  |
| ISC-77 | manual | screen-reader pass over the sync history | no blocker | transcript in `.evidence/` | derived: console-usable |  |
| ISC-78 | browser | theme-switch: keyboard reach and focus ring | all reachable | `bun run test:browser -- theme-switch` | derived: console-usable |  |
| ISC-81 | bash | loader call sites for the project file | exactly 1 | `rg -c 'loadConfig\(' cli/src api/src` | derived: one-config-path |  |
| ISC-82 | bun-test | effective config snapshot, case 1 | equal to the pre-rewrite snapshot | `bun test tests/config.test.ts -t "parity 1"` | derived: one-config-path |  |
| ISC-83 | bash | loader call sites for the user file | exactly 1 | `rg -c 'loadConfig\(' cli/src api/src` | derived: one-config-path |  |
| ISC-84 | bun-test | effective config snapshot, case 3 | equal to the pre-rewrite snapshot | `bun test tests/config.test.ts -t "parity 3"` | derived: one-config-path |  |
| ISC-85 | bash | loader call sites for environment overrides | exactly 1 | `rg -c 'loadConfig\(' cli/src api/src` | derived: one-config-path |  |
| ISC-86 | bun-test | effective config snapshot, case 5 | equal to the pre-rewrite snapshot | `bun test tests/config.test.ts -t "parity 5"` | derived: one-config-path |  |
| ISC-87 | bash | loader call sites for command-line flags | exactly 1 | `rg -c 'loadConfig\(' cli/src api/src` | derived: one-config-path |  |
| ISC-88 | bun-test | effective config snapshot, case 7 | equal to the pre-rewrite snapshot | `bun test tests/config.test.ts -t "parity 7"` | derived: one-config-path |  |
| ISC-89 | bash | loader call sites for a missing file | exactly 1 | `rg -c 'loadConfig\(' cli/src api/src` | derived: one-config-path |  |
| ISC-90 | bun-test | effective config snapshot, case 9 | equal to the pre-rewrite snapshot | `bun test tests/config.test.ts -t "parity 9"` | derived: one-config-path |  |
| ISC-91 | bash | loader call sites for an unknown key | exactly 1 | `rg -c 'loadConfig\(' cli/src api/src` | derived: one-config-path |  |
| ISC-92 | bun-test | effective config snapshot, case 11 | equal to the pre-rewrite snapshot | `bun test tests/config.test.ts -t "parity 11"` | derived: one-config-path |  |
| ISC-93 | bash | loader call sites for a duplicated key | exactly 1 | `rg -c 'loadConfig\(' cli/src api/src` | derived: one-config-path |  |
| ISC-94 | manual | decision row for the config format | present | review of `ISA.md` § Decisions | derived: one-config-path |  |
| ISC-95 | bun-test | verdict log for keep-last-N | one line per manifest | `bun test tests/retention.test.ts -t "keep-last-N"` | literal |  |
| ISC-96 | bun-test | verdict log for keep-newer-than | one line per manifest | `bun test tests/retention.test.ts -t "keep-newer-than"` | literal |  |
| ISC-97 | bun-test | verdict log for keep-by-tag-pattern | one line per manifest | `bun test tests/retention.test.ts -t "keep-by-tag-pattern"` | literal |  |
| ISC-98 | bun-test | verdict log for a protected tag | one line per manifest | `bun test tests/retention.test.ts -t "a protected tag"` | literal |  |
| ISC-99 | bun-test | verdict log for an untagged manifest | one line per manifest | `bun test tests/retention.test.ts -t "an untagged manifest"` | literal |  |
| ISC-100 | bun-test | verdict log for a policy preview | one line per manifest | `bun test tests/retention.test.ts -t "a policy preview"` | literal |  |
| ISC-101 | bun-test | verdict log for a policy conflict | one line per manifest | `bun test tests/retention.test.ts -t "a policy conflict"` | literal |  |
| ISC-102 | bun-test | verdict log for a scheduled run | one line per manifest | `bun test tests/retention.test.ts -t "a scheduled run"` | literal |  |
| ISC-103 | bun-test | verdict log for a manual run | one line per manifest | `bun test tests/retention.test.ts -t "a manual run"` | literal |  |
| ISC-104 | bun-test | verdict log for a policy file with comments | one line per manifest | `bun test tests/retention.test.ts -t "a policy file with comments"` | literal |  |
| ISC-105 | bun-test | referenced manifests deleted for keep-last-N | 0 | `bun test tests/retention.test.ts -t "keep-last-N"` | derived: never-lose-a-referenced-manifest | high |
| ISC-106 | bun-test | referenced manifests deleted for keep-newer-than | 0 | `bun test tests/retention.test.ts -t "keep-newer-than"` | derived: never-lose-a-referenced-manifest | high |
| ISC-107 | bun-test | referenced manifests deleted for keep-by-tag-pattern | 0 | `bun test tests/retention.test.ts -t "keep-by-tag-pattern"` | derived: never-lose-a-referenced-manifest | high |
| ISC-108 | bun-test | referenced manifests deleted for a protected tag | 0 | `bun test tests/retention.test.ts -t "a protected tag"` | derived: never-lose-a-referenced-manifest | high |
| ISC-109 | bun-test | referenced manifests deleted for an untagged manifest | 0 | `bun test tests/retention.test.ts -t "an untagged manifest"` | derived: never-lose-a-referenced-manifest | high |
| ISC-110 | bun-test | referenced manifests deleted for a policy preview | 0 | `bun test tests/retention.test.ts -t "a policy preview"` | derived: never-lose-a-referenced-manifest | high |
| ISC-111 | bun-test | referenced manifests deleted for a policy conflict | 0 | `bun test tests/retention.test.ts -t "a policy conflict"` | derived: never-lose-a-referenced-manifest | high |
| ISC-112 | bun-test | referenced manifests deleted for a scheduled run | 0 | `bun test tests/retention.test.ts -t "a scheduled run"` | derived: never-lose-a-referenced-manifest | high |
| ISC-113 | bun-test | referenced manifests deleted for a manual run | 0 | `bun test tests/retention.test.ts -t "a manual run"` | derived: never-lose-a-referenced-manifest | high |
| ISC-114 | bun-test | referenced manifests deleted for a policy file with comments | 0 | `bun test tests/retention.test.ts -t "a policy file with comments"` | derived: never-lose-a-referenced-manifest | high |
| ISC-115 | e2e | preview shown for keep-last-N | before delete | `bun run e2e -- retention -g "preview 1"` | literal |  |
| ISC-116 | e2e | preview shown for keep-newer-than | before delete | `bun run e2e -- retention -g "preview 2"` | literal |  |
| ISC-117 | e2e | preview shown for keep-by-tag-pattern | before delete | `bun run e2e -- retention -g "preview 3"` | literal |  |
| ISC-118 | e2e | preview shown for a protected tag | before delete | `bun run e2e -- retention -g "preview 4"` | literal |  |
| ISC-119 | e2e | preview shown for an untagged manifest | before delete | `bun run e2e -- retention -g "preview 5"` | literal |  |
| ISC-120 | e2e | preview shown for a policy preview | before delete | `bun run e2e -- retention -g "preview 6"` | literal |  |
| ISC-121 | e2e | preview shown for a policy conflict | before delete | `bun run e2e -- retention -g "preview 7"` | literal |  |
| ISC-122 | e2e | preview shown for a scheduled run | before delete | `bun run e2e -- retention -g "preview 8"` | literal |  |
| ISC-123 | e2e | preview shown for a manual run | before delete | `bun run e2e -- retention -g "preview 9"` | literal |  |
| ISC-124 | e2e | preview shown for a policy file with comments | before delete | `bun run e2e -- retention -g "preview 10"` | literal |  |

## Features

### F0 · Cross-cutting
Why: what would sink Harbor whichever feature slipped — a half-written manifest, a silent failure or a leaked credential.

- [ ] ISC-1: Anti: a failed push leaves a partial manifest visible in the target registry.
- [ ] ISC-2: Every command exits non-zero when any repository in the run failed.
- [ ] ISC-3: Anti: a registry credential appears in a log line, an error message or the sync history.
- [ ] ISC-4: The API and the web console bind to loopback unless `--listen` names another address.

### F1 · Manifest sync
Why: one command mirrors every manifest a team depends on into its own registry, and running it again changes nothing.

- [x] ISC-5: `harbor sync` copies a single-platform manifest to the target registry with an identical digest.
- [x] ISC-6: `harbor sync` copies a multi-platform index to the target registry with an identical digest. (after: ISC-5)
- [x] ISC-7: `harbor sync` copies a manifest pinned by digest to the target registry with an identical digest.
- [x] ISC-8: `harbor sync` copies a manifest referenced by tag to the target registry with an identical digest.
- [x] ISC-9: `harbor sync` copies an attestation attached to a manifest to the target registry with an identical digest.
- [x] ISC-10: `harbor sync` copies a signature artifact to the target registry with an identical digest.
- [x] ISC-11: `harbor sync` copies a manifest larger than 4 MB to the target registry with an identical digest. (after: ISC-10)
- [x] ISC-12: `harbor sync` copies a blob already present in the target to the target registry with an identical digest.
- [x] ISC-13: `harbor sync` copies a layer shared by two manifests to the target registry with an identical digest.
- [x] ISC-14: `harbor sync` copies a manifest whose source answers 404 to the target registry with an identical digest.
- [x] ISC-15: `harbor sync` copies a registry that answers 429 to the target registry with an identical digest.
- [x] ISC-16: `harbor sync` copies an empty repository to the target registry with an identical digest. (after: ISC-15)
- [x] ISC-17: A dry run over a single-platform manifest prints the planned push and writes nothing.
- [x] ISC-18: A dry run over a multi-platform index prints the planned push and writes nothing.
- [x] ISC-19: A dry run over a manifest pinned by digest prints the planned push and writes nothing.
- [x] ISC-20: A dry run over a manifest referenced by tag prints the planned push and writes nothing.
- [x] ISC-21: A dry run over an attestation attached to a manifest prints the planned push and writes nothing. (after: ISC-20)
- [x] ISC-22: A dry run over a signature artifact prints the planned push and writes nothing.
- [x] ISC-23: A dry run over a manifest larger than 4 MB prints the planned push and writes nothing.
- [x] ISC-24: A dry run over a blob already present in the target prints the planned push and writes nothing.
- [x] ISC-25: A dry run over a layer shared by two manifests prints the planned push and writes nothing.
- [x] ISC-26: A dry run over a manifest whose source answers 404 prints the planned push and writes nothing. (after: ISC-25)
- [x] ISC-27: A dry run over a registry that answers 429 prints the planned push and writes nothing.
- [x] ISC-28: A dry run over an empty repository prints the planned push and writes nothing.
- [x] ISC-29: Anti: syncing a single-platform manifest twice uploads a byte the second time.
- [x] ISC-30: Anti: syncing a multi-platform index twice uploads a byte the second time.
- [x] ISC-31: Anti: syncing a manifest pinned by digest twice uploads a byte the second time. (after: ISC-30)
- [x] ISC-32: Anti: syncing a manifest referenced by tag twice uploads a byte the second time.
- [x] ISC-33: Anti: syncing an attestation attached to a manifest twice uploads a byte the second time.
- [x] ISC-34: Anti: syncing a signature artifact twice uploads a byte the second time.
- [x] ISC-35: Anti: syncing a manifest larger than 4 MB twice uploads a byte the second time.
- [x] ISC-36: Anti: syncing a blob already present in the target twice uploads a byte the second time. (after: ISC-35)
- [x] ISC-37: Anti: syncing a layer shared by two manifests twice uploads a byte the second time.
- [x] ISC-38: Anti: syncing a manifest whose source answers 404 twice uploads a byte the second time.
- [x] ISC-39: Anti: syncing a registry that answers 429 twice uploads a byte the second time.
- [x] ISC-40: Anti: syncing an empty repository twice uploads a byte the second time.
- [x] ISC-41: The sync log names a single-platform manifest with its source and target reference. (after: ISC-40)
- [x] ISC-42: The sync log names a multi-platform index with its source and target reference.
- [x] ISC-43: The sync log names a manifest pinned by digest with its source and target reference.
- [x] ISC-44: The sync log names a manifest referenced by tag with its source and target reference.
- [x] ISC-45: The sync log names an attestation attached to a manifest with its source and target reference.
- [x] ISC-46: The sync log names a signature artifact with its source and target reference. (after: ISC-45)
- [x] ISC-47: The sync log names a manifest larger than 4 MB with its source and target reference.
- [x] ISC-48: The sync log names a blob already present in the target with its source and target reference.
- [x] ISC-49: The sync log names a layer shared by two manifests with its source and target reference.
- [x] ISC-50: The sync log names a manifest whose source answers 404 with its source and target reference.

### F2 · Web console
Why: a teammate who never touches the CLI can see what was mirrored, when, and what failed.

- [x] ISC-51: The registry list renders from the API with no console error.
- [x] ISC-52: The repository view renders from the API with no console error.
- [x] ISC-53: The tag table renders from the API with no console error.
- [x] ISC-54: The digest detail panel renders from the API with no console error.
- [x] ISC-55: The sync history renders from the API with no console error.
- [x] ISC-56: The settings page renders from the API with no console error.
- [x] ISC-57: The search box renders from the API with no console error.
- [x] ISC-58: The empty state renders from the API with no console error.
- [x] ISC-59: The error banner renders from the API with no console error.
- [x] ISC-60: The theme switch renders from the API with no console error.
- [x] ISC-60.1: The theme switch follows the system colour scheme until a mode is chosen. (after: ISC-60)
- [x] ISC-60.2: A chosen colour mode survives a reload of the console. (after: ISC-60)
- [x] ISC-61: The tag table stays usable at 390 px without horizontal scrolling.
- [x] ISC-62: The digest detail panel stays usable at 390 px without horizontal scrolling.
- [x] ISC-63: The sync history stays usable at 390 px without horizontal scrolling.
- [x] ISC-64: The settings page stays usable at 390 px without horizontal scrolling.
- [x] ISC-65: The search box stays usable at 390 px without horizontal scrolling.
- [x] ISC-66: The empty state stays usable at 390 px without horizontal scrolling. (after: ISC-65)
- [x] ISC-67: The error banner stays usable at 390 px without horizontal scrolling.
- [x] ISC-68: The theme switch stays usable at 390 px without horizontal scrolling.
- [x] ISC-69: Every interactive element in the registry list is reachable by keyboard and shows a focus ring.
- [x] ISC-70: Every interactive element in the repository view is reachable by keyboard and shows a focus ring.
- [x] ISC-71: Every interactive element in the tag table is reachable by keyboard and shows a focus ring.
- [x] ISC-72: Every interactive element in the digest detail panel is reachable by keyboard and shows a focus ring.
- [x] ISC-73: Every interactive element in the sync history is reachable by keyboard and shows a focus ring.
- [ ] ISC-74: Every interactive element in the settings page is reachable by keyboard and shows a focus ring.
- [ ] ISC-75: Every interactive element in the search box is reachable by keyboard and shows a focus ring.
- [ ] ISC-76: Every interactive element in the empty state is reachable by keyboard and shows a focus ring.
- [ ] ISC-77: Every interactive element in the error banner is reachable by keyboard and shows a focus ring.
- [ ] ISC-78: Every interactive element in the theme switch is reachable by keyboard and shows a focus ring. (after: ISC-77)

### F3 · Config loader rewrite
Why: the CLI, the API and the console read one config through one loader, so a setting means the same thing everywhere.

- [ ] ISC-81: The loader reads the project file through one code path.
- [ ] ISC-82: Anti: the project file produces a different effective config than before the rewrite. (after: ISC-81)
- [ ] ISC-83: The loader reads the user file through one code path.
- [ ] ISC-84: Anti: the user file produces a different effective config than before the rewrite. (after: ISC-83)
- [ ] ISC-85: The loader reads environment overrides through one code path.
- [ ] ISC-86: Anti: environment overrides produces a different effective config than before the rewrite. (after: ISC-85)
- [ ] ISC-87: The loader reads command-line flags through one code path.
- [ ] ISC-88: Anti: command-line flags produces a different effective config than before the rewrite. (after: ISC-87)
- [ ] ISC-89: The loader reads a missing file through one code path.
- [ ] ISC-90: Anti: a missing file produces a different effective config than before the rewrite. (after: ISC-89)
- [ ] ISC-91: The loader reads an unknown key through one code path.
- [ ] ISC-92: Anti: an unknown key produces a different effective config than before the rewrite. (after: ISC-91)
- [ ] ISC-93: The loader reads a duplicated key through one code path.
- [ ] ISC-94: Antecedent: the config format for version 2 is chosen and recorded as a decision.

### F4 · Retention policies
Why: old manifests go away on a schedule the team wrote down, and nothing still in use ever does.

- [x] ISC-95: For keep-last-N, the retention engine evaluates every repository and logs one verdict per manifest.
- [x] ISC-96: For keep-newer-than, the retention engine evaluates every repository and logs one verdict per manifest.
- [x] ISC-97: For keep-by-tag-pattern, the retention engine evaluates every repository and logs one verdict per manifest.
- [x] ISC-98: For a protected tag, the retention engine evaluates every repository and logs one verdict per manifest.
- [x] ISC-99: For an untagged manifest, the retention engine evaluates every repository and logs one verdict per manifest.
- [x] ISC-100: For a policy preview, the retention engine evaluates every repository and logs one verdict per manifest.
- [x] ISC-101: For a policy conflict, the retention engine evaluates every repository and logs one verdict per manifest.
- [x] ISC-102: For a scheduled run, the retention engine evaluates every repository and logs one verdict per manifest.
- [x] ISC-103: For a manual run, the retention engine evaluates every repository and logs one verdict per manifest.
- [x] ISC-104: For a policy file with comments, the retention engine evaluates every repository and logs one verdict per manifest.
- [x] ISC-105: Anti: keep-last-N deletes a manifest that another tag still references.
- [x] ISC-106: Anti: keep-newer-than deletes a manifest that another tag still references.
- [x] ISC-107: Anti: keep-by-tag-pattern deletes a manifest that another tag still references.
- [x] ISC-108: Anti: a protected tag deletes a manifest that another tag still references.
- [x] ISC-109: Anti: an untagged manifest deletes a manifest that another tag still references.
- [x] ISC-110: Anti: a policy preview deletes a manifest that another tag still references.
- [x] ISC-111: Anti: a policy conflict deletes a manifest that another tag still references.
- [x] ISC-112: Anti: a scheduled run deletes a manifest that another tag still references.
- [x] ISC-113: Anti: a manual run deletes a manifest that another tag still references.
- [x] ISC-114: Anti: a policy file with comments deletes a manifest that another tag still references.
- [x] ISC-115: The console shows the effect of keep-last-N before anything is deleted. (after: ISC-95)
- [x] ISC-116: The console shows the effect of keep-newer-than before anything is deleted. (after: ISC-96)
- [x] ISC-117: The console shows the effect of keep-by-tag-pattern before anything is deleted. (after: ISC-97)
- [x] ISC-118: The console shows the effect of a protected tag before anything is deleted. (after: ISC-98)
- [x] ISC-119: The console shows the effect of an untagged manifest before anything is deleted. (after: ISC-99)
- [x] ISC-120: The console shows the effect of a policy preview before anything is deleted. (after: ISC-100)
- [x] ISC-121: The console shows the effect of a policy conflict before anything is deleted. (after: ISC-101)
- [x] ISC-122: The console shows the effect of a scheduled run before anything is deleted. (after: ISC-102)
- [x] ISC-123: The console shows the effect of a manual run before anything is deleted. (after: ISC-103)
- [x] ISC-124: The console shows the effect of a policy file with comments before anything is deleted. (after: ISC-104)

## Decisions

- 2026-03-02: features split into sync, console, config loader and retention; cross-cutting claims in F0.
- 2026-03-05: spec 001 closed and archived; sync is idempotent on digest, not on tag.
- 2026-03-07: refined: the console's colour mode is a stored setting (ISC-60.1, ISC-60.2).

## Verification

- ISC-5: `bun test tests/sync.test.ts -t "case 5"` passed, 2026-03-05
- ISC-6: `bun test tests/sync.test.ts -t "case 6"` passed, 2026-03-05
- ISC-7: `bun test tests/sync.test.ts -t "case 7"` passed, 2026-03-05
- ISC-8: `bun test tests/sync.test.ts -t "case 8"` passed, 2026-03-05
- ISC-9: `bun test tests/sync.test.ts -t "case 9"` passed, 2026-03-05
- ISC-10: `bun test tests/sync.test.ts -t "case 10"` passed, 2026-03-05
- ISC-11: `bun test tests/sync.test.ts -t "case 11"` passed, 2026-03-05
- ISC-12: `bun test tests/sync.test.ts -t "case 12"` passed, 2026-03-05
- ISC-13: `bun test tests/sync.test.ts -t "case 13"` passed, 2026-03-05
- ISC-14: `bun test tests/sync.test.ts -t "case 14"` passed, 2026-03-05
- ISC-15: `bun test tests/sync.test.ts -t "case 15"` passed, 2026-03-05
- ISC-16: `bun test tests/sync.test.ts -t "case 16"` passed, 2026-03-05
- ISC-17: `bun run cli -- sync --dry-run --case 1 | rg -c PUSH` passed, 2026-03-05
- ISC-18: `bun run cli -- sync --dry-run --case 2 | rg -c PUSH` passed, 2026-03-05
- ISC-19: `bun run cli -- sync --dry-run --case 3 | rg -c PUSH` passed, 2026-03-05
- ISC-20: `bun run cli -- sync --dry-run --case 4 | rg -c PUSH` passed, 2026-03-05
- ISC-21: `bun run cli -- sync --dry-run --case 5 | rg -c PUSH` passed, 2026-03-05
- ISC-22: `bun run cli -- sync --dry-run --case 6 | rg -c PUSH` passed, 2026-03-05
- ISC-23: `bun run cli -- sync --dry-run --case 7 | rg -c PUSH` passed, 2026-03-05
- ISC-24: `bun run cli -- sync --dry-run --case 8 | rg -c PUSH` passed, 2026-03-05
- ISC-25: `bun run cli -- sync --dry-run --case 9 | rg -c PUSH` passed, 2026-03-05
- ISC-26: `bun run cli -- sync --dry-run --case 10 | rg -c PUSH` passed, 2026-03-05
- ISC-27: `bun run cli -- sync --dry-run --case 11 | rg -c PUSH` passed, 2026-03-05
- ISC-28: `bun run cli -- sync --dry-run --case 12 | rg -c PUSH` passed, 2026-03-05
- ISC-29: `bun test tests/sync.test.ts -t "case 29"` passed, 2026-03-05
- ISC-30: `bun test tests/sync.test.ts -t "case 30"` passed, 2026-03-05
- ISC-31: `bun test tests/sync.test.ts -t "case 31"` passed, 2026-03-05
- ISC-32: `bun test tests/sync.test.ts -t "case 32"` passed, 2026-03-05
- ISC-33: `bun test tests/sync.test.ts -t "case 33"` passed, 2026-03-05
- ISC-34: `bun test tests/sync.test.ts -t "case 34"` passed, 2026-03-05
- ISC-35: `bun test tests/sync.test.ts -t "case 35"` passed, 2026-03-05
- ISC-36: `bun test tests/sync.test.ts -t "case 36"` passed, 2026-03-05
- ISC-37: `bun test tests/sync.test.ts -t "case 37"` passed, 2026-03-05
- ISC-38: `bun test tests/sync.test.ts -t "case 38"` passed, 2026-03-05
- ISC-39: `bun test tests/sync.test.ts -t "case 39"` passed, 2026-03-05
- ISC-40: `bun test tests/sync.test.ts -t "case 40"` passed, 2026-03-05
- ISC-41: `bun test tests/sync.test.ts -t "case 41"` passed, 2026-03-05
- ISC-42: `bun test tests/sync.test.ts -t "case 42"` passed, 2026-03-05
- ISC-43: `bun test tests/sync.test.ts -t "case 43"` passed, 2026-03-05
- ISC-44: `bun test tests/sync.test.ts -t "case 44"` passed, 2026-03-05
- ISC-45: `bun test tests/sync.test.ts -t "case 45"` passed, 2026-03-05
- ISC-46: `bun test tests/sync.test.ts -t "case 46"` passed, 2026-03-05
- ISC-47: `bun test tests/sync.test.ts -t "case 47"` passed, 2026-03-05
- ISC-48: `bun test tests/sync.test.ts -t "case 48"` passed, 2026-03-05
- ISC-49: `bun test tests/sync.test.ts -t "case 49"` passed, 2026-03-05
- ISC-50: `bun test tests/sync.test.ts -t "case 50"` passed, 2026-03-05
- ISC-51: `bun run e2e -- registry-list -g render` passed, 2026-03-08
- ISC-52: `bun run e2e -- repository-view -g render` passed, 2026-03-08
- ISC-53: `bun run e2e -- tag-table -g render` passed, 2026-03-08
- ISC-54: `bun run e2e -- digest-detail-panel -g render` passed, 2026-03-08
- ISC-55: `bun run e2e -- sync-history -g render` passed, 2026-03-08
- ISC-56: `bun run e2e -- settings-page -g render` passed, 2026-03-08
- ISC-57: `bun run e2e -- search-box -g render` passed, 2026-03-08
- ISC-58: `bun run e2e -- empty-state -g render` passed, 2026-03-08
- ISC-59: `bun run e2e -- error-banner -g render` passed, 2026-03-08
- ISC-60: `bun run e2e -- theme-switch -g render` passed, 2026-03-08
- ISC-60.1: `bun run e2e -- theme-switch -g system` passed, 2026-03-08
- ISC-60.2: `bun run e2e -- theme-switch -g persist` passed, 2026-03-08
- ISC-61: `bun run e2e -- tag-table -g narrow` passed, 2026-03-08
- ISC-62: `bun run e2e -- digest-detail-panel -g narrow` passed, 2026-03-08
- ISC-63: `bun run e2e -- sync-history -g narrow` passed, 2026-03-08
- ISC-64: `bun run e2e -- settings-page -g narrow` passed, 2026-03-08
- ISC-65: `bun run e2e -- search-box -g narrow` passed, 2026-03-08
- ISC-66: `bun run e2e -- empty-state -g narrow` passed, 2026-03-08
- ISC-67: `bun run e2e -- error-banner -g narrow` passed, 2026-03-08
- ISC-68: `bun run e2e -- theme-switch -g narrow` passed, 2026-03-08
- ISC-69: `bun run test:browser -- registry-list` passed, 2026-03-08
- ISC-70: `bun run test:browser -- repository-view` passed, 2026-03-08
- ISC-71: `bun run test:browser -- tag-table` passed, 2026-03-08
- ISC-72: `bun run test:browser -- digest-detail-panel` passed, 2026-03-08
- ISC-73: `bun run test:browser -- sync-history` passed, 2026-03-08
- ISC-95: `bun test tests/retention.test.ts -t "keep-last-N"` passed, 2026-03-08
- ISC-96: `bun test tests/retention.test.ts -t "keep-newer-than"` passed, 2026-03-08
- ISC-97: `bun test tests/retention.test.ts -t "keep-by-tag-pattern"` passed, 2026-03-08
- ISC-98: `bun test tests/retention.test.ts -t "a protected tag"` passed, 2026-03-08
- ISC-99: `bun test tests/retention.test.ts -t "an untagged manifest"` passed, 2026-03-08
- ISC-100: `bun test tests/retention.test.ts -t "a policy preview"` passed, 2026-03-08
- ISC-101: `bun test tests/retention.test.ts -t "a policy conflict"` passed, 2026-03-08
- ISC-102: `bun test tests/retention.test.ts -t "a scheduled run"` passed, 2026-03-08
- ISC-103: `bun test tests/retention.test.ts -t "a manual run"` passed, 2026-03-08
- ISC-104: `bun test tests/retention.test.ts -t "a policy file with comments"` passed, 2026-03-08
- ISC-105: `bun test tests/retention.test.ts -t "keep-last-N"` passed, 2026-03-08
- ISC-106: `bun test tests/retention.test.ts -t "keep-newer-than"` passed, 2026-03-08
- ISC-107: `bun test tests/retention.test.ts -t "keep-by-tag-pattern"` passed, 2026-03-08
- ISC-108: `bun test tests/retention.test.ts -t "a protected tag"` passed, 2026-03-08
- ISC-109: `bun test tests/retention.test.ts -t "an untagged manifest"` passed, 2026-03-08
- ISC-110: `bun test tests/retention.test.ts -t "a policy preview"` passed, 2026-03-08
- ISC-111: `bun test tests/retention.test.ts -t "a policy conflict"` passed, 2026-03-08
- ISC-112: `bun test tests/retention.test.ts -t "a scheduled run"` passed, 2026-03-08
- ISC-113: `bun test tests/retention.test.ts -t "a manual run"` passed, 2026-03-08
- ISC-114: `bun test tests/retention.test.ts -t "a policy file with comments"` passed, 2026-03-08
- ISC-115: `bun run e2e -- retention -g "preview 1"` passed, 2026-03-08
- ISC-116: `bun run e2e -- retention -g "preview 2"` passed, 2026-03-08
- ISC-117: `bun run e2e -- retention -g "preview 3"` passed, 2026-03-08
- ISC-118: `bun run e2e -- retention -g "preview 4"` passed, 2026-03-08
- ISC-119: `bun run e2e -- retention -g "preview 5"` passed, 2026-03-08
- ISC-120: `bun run e2e -- retention -g "preview 6"` passed, 2026-03-08
- ISC-121: `bun run e2e -- retention -g "preview 7"` passed, 2026-03-08
- ISC-122: `bun run e2e -- retention -g "preview 8"` passed, 2026-03-08
- ISC-123: `bun run e2e -- retention -g "preview 9"` passed, 2026-03-08
- ISC-124: `bun run e2e -- retention -g "preview 10"` passed, 2026-03-08

## Remaining Work

- [ ] Publish a sample config for the three most common registries — waits on the config format decision (spec 005).
