# Plan 002 — Ingredient search

## Approach

The command reads every recipe's `## Ingredients` list once, lowercases each line and keeps the recipes whose lines
contain every query word. The output is one line per recipe: title, then the matching ingredient lines.

## Stack Decisions

| Concern | Choice | Why |
|---------|--------|-----|
| Index | none; a linear scan per call | a recipe box holds a few hundred files |
| Matching | case-insensitive substring | the prototype's users typed partial words |

## Risks

- A recipe without an `## Ingredients` heading never matches; the command lists such files once as a warning.
- A large box makes every search read every file; an index waits until a search takes longer than one second.
