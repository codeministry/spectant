# ab-repo — the measuring fixture of spec 010 (ISC-344)

A throwaway repository template for an A/B implement round: one reviewed feature spec (`specs/001-text-helpers/`, three
parallel tasks, about 6 KB of spec prose and twenty Decisions rows) over an empty `src/`.

Run it twice, once per plugin build, each in its own copy (the transcripts land in separate project folders):

1. Copy this folder twice, `git init` each copy, commit, and set the review mark with that build's CLI:
   `bun <plugin>/bin/spec-check gate reviewed 001 --yes` (the mark is gitignored).
2. In each copy, with the Max OAuth token and no `ANTHROPIC_API_KEY`, pipe the prompt
   `/spectant:spec implement 001` into
   `claude -p --plugin-dir <plugin> --settings '{"enabledPlugins":{"spectant@spectant":false}}' --permission-mode acceptEdits --disallowedTools AskUserQuestion --allowedTools …`
   (A: the plugin before spec 010, B: the plugin with the pack brief).
3. In each copy, `spectant tokens --root <copy> --yes`, then compare the `/spec implement` invocation and round lines
   of `specs/tokens.jsonl`: `input` plus `cache_read`.
