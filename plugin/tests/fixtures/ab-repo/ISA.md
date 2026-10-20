---
project: textkit
progress: 0/4
---

# Textkit

## Goal

Small, dependency-free text helpers that behave the same on every input.

## Features

### F1 · Text helpers
Why: titles, slugs and previews in the app need one well-tested implementation each.

- [ ] ISC-1: `slugify(text)` follows every slug rule of this spec's Decisions that names ISC-1 or T1, and `slugify("Hello,  World!")` is `hello-world`.
- [ ] ISC-2: `truncate(text, max)` follows every truncation rule of this spec's Decisions that names ISC-2 or T2, and its result never exceeds `max` characters.
- [ ] ISC-3: `titleCase(text)` follows every casing rule of this spec's Decisions that names ISC-3 or T3, and `titleCase("the lord of the rings")` is `The Lord of the Rings`.
- [ ] ISC-4: `wordCount(text)` follows every counting rule of this spec's Decisions that names ISC-4 or T4, and `wordCount("one  two\nthree")` is 3.

## Test Strategy

| isc | type | check | threshold | tool | anchors_to | severity |
|-----|------|-------|-----------|------|------------|----------|
| ISC-1 | bun-test | slugify: every ISC-1 rule | all cases equal | `bun test src/slugify.test.ts` | derived: slugs | high |
| ISC-2 | bun-test | truncate: every ISC-2 rule | length <= max | `bun test src/truncate.test.ts` | derived: previews | high |
| ISC-3 | bun-test | titleCase: every ISC-3 rule | all cases equal | `bun test src/titlecase.test.ts` | derived: titles | high |
| ISC-4 | bun-test | wordCount: every ISC-4 rule | all cases equal | `bun test src/wordcount.test.ts` | derived: counts | high |

## Decisions

## Verification
