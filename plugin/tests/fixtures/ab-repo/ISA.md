---
project: textkit
progress: 0/3
---

# Textkit

## Goal

Small, dependency-free text helpers that behave the same on every input.

## Features

### F1 · Text helpers
Why: titles, slugs and previews in the app need one well-tested implementation each.

- [ ] ISC-1: `slugify(text)` returns the text lower-cased, with every run of characters other than a-z and 0-9 replaced by one hyphen and no hyphen at either end: `slugify("Hello,  World!")` is `hello-world`.
- [ ] ISC-2: `truncate(text, max)` returns the text unchanged when it has at most `max` characters, else its first `max - 1` characters plus `…`, so the result never exceeds `max` characters.
- [ ] ISC-3: Anti: `titleCase(text)` capitalises `a`, `an`, `the`, `of`, `and` or `in` when the word stands neither first nor last.

## Test Strategy

| isc | type | check | threshold | tool | anchors_to | severity |
|-----|------|-------|-----------|------|------------|----------|
| ISC-1 | bun-test | slugify: punctuation, spaces, case | all cases equal | `bun test src/slugify.test.ts` | derived: slugs | high |
| ISC-2 | bun-test | truncate: short, exact, long | length <= max | `bun test src/truncate.test.ts` | derived: previews | high |
| ISC-3 | bun-test | titleCase: small words in the middle | 0 capitalised small words | `bun test src/titlecase.test.ts` | derived: titles | high |

## Decisions

## Verification
