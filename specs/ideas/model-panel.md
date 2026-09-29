/spec

## Type
feature

## Repo
spectant (this repository)
Slug: model-panel

## Goal (one sentence)
A side panel answers questions about a workspace's specs with a model the user switched on, and never writes.
<!-- The principal's own goal sentence is asked at CreateSpec and lands in the untracked master only. -->

## Problem
Questions like "what is outdated?" or "sum up where we stand" cost a full agent run today.

## Vision
A side panel per workspace answers questions from its specs and library with a model the user switched on: local
through Ollama, or the user's own key.

## In
- Panel per workspace; the context is the workspace's specs and library
- Two adapters: OpenAI-compatible chat (Ollama, LM Studio and others by base URL) and the Anthropic Messages API
- Off by default, no provider preconfigured; a notice before the first send whenever the base URL is not loopback
- Keys kept in the app's data directory, never in a repository

## Out
- No writes, no tools or function calling
- No content translation (its own later spec)

## Done means (observable)
- A fresh install shows the panel off and makes no network call → offline test
- Against a stub OpenAI-compatible server on loopback, a question returns an answer built from fixture specs → bun-test
- A non-loopback base URL shows the notice before the first send → e2e
- Anti: a key appears in a repository file or a log → test
- Anti: the panel causes any write → test

## Guard rails
- `ISA.md` § Principles, "local by design": allowed because the user switches the feature on and its whole point is to
  send
- Moves "AI chat inside the app" from Remaining Work and Out of Scope into a feature; XC-11 holds (no default external
  host)

## What the repository does not know
The principal wants the Anthropic adapter next to the OpenAI-compatible one from the first version.

## Open / unsure
Context size for large workspaces (whole files or retrieval); key storage in the OS keychain or in a file.

## Mode
Draft first, mark assumptions as `⟨?: …⟩`, ask only structural questions.

## Shaping record (round 0, 2026-09-29)
- Shapes offered: workspace Q&A with Ollama or own key (recommended) | one spec, Ollama only | translation first;
  chosen: workspace Q&A with Ollama or own key
- Q1 · Which provider interfaces besides Ollama in the first version? — Offered: OpenAI-compatible plus Anthropic
  (recommended) | OpenAI-compatible only | Ollama only — Chosen: OpenAI-compatible plus Anthropic — Field: In
