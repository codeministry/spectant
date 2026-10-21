/**
 * The transcript side of the token measurement (spec 009, T7, ISC-135; `spectant tokens`, `command.ts`).
 *
 * The transcript folder is `--transcripts DIR`, or `<config>/projects/<encoded root>/` with `<config>` the
 * `$CLAUDE_CONFIG_DIR` or `~/.claude` and the root encoded as Claude Code encodes it (`encodeProjectPath`). Read
 * from it: the main sessions `<session>.jsonl`, the sub-agents `<session>/subagents/agent-<id>.jsonl` with the
 * `toolUseId` of their `agent-<id>.meta.json`, the sessions of every sibling folder named exactly
 * `<folder>--claude-worktrees-agent-<id>` (the repository's agent worktrees), and the spec worktrees' sibling
 * folders, each read like the folder itself (main sessions and their sub-agents): every one named exactly
 * `<folder>--worktrees-NNN-slug` with three digits and a kebab-case slug, letters in either case (a spec worktree `.worktrees/NNN-slug`
 * inside the repository) and every one named exactly `<folder>-NNN` with three digits (the older sibling layout
 * `../<root>-NNN`). The three patterns exclude one another, so no folder is read twice, and a nested agent worktree
 * `<folder>--worktrees-NNN-slug--claude-worktrees-agent-<id>` matches none. A folder that cannot be read is exit 1;
 * a single file that cannot be read is a diagnostic. Every list is sorted in byte order, so nothing depends on the
 * order `readdir` happens to return. Nothing of a transcript is parsed here; core measures it.
 */
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import type { TokenDiagnostic, TranscriptFile } from "../../../core/src/tokens.ts";
import { unreadableCode } from "../infra/fs/errno.ts";
import { type Dirent, listEntries, readText } from "../infra/fs/list.ts";

export type Env = Record<string, string | undefined>;

/** The infix between a repository's encoded root and an agent worktree's id in a sibling project folder's name. */
export const WORKTREE_INFIX = "--claude-worktrees-agent-";

/** An agent worktree id: letters and digits only, so a folder of a path nested below a worktree is not taken for one. */
const WORKTREE_ID = /^[A-Za-z0-9]+$/;

/**
 * What follows the encoded root in a spec worktree's project folder (`../<root>-NNN` encodes to `<encoded root>-NNN`):
 * `-` and exactly three digits, so `-0123` and `-012--claude-worktrees-agent-<id>` are not one.
 */
const SPEC_WORKTREE_SUFFIX = /^-\d{3}$/;

/**
 * What follows the encoded root in the project folder of a spec worktree inside the repository (`.worktrees/NNN-slug`
 * encodes to `<encoded root>--worktrees-NNN-slug`): three digits and a kebab-case slug of letters in either case and
 * digits, without `--`, so a nested agent worktree `…--worktrees-NNN-slug--claude-worktrees-agent-<id>` is not one, and
 * `WORKTREE_INFIX` never overlaps it.
 */
const IN_REPO_SPEC_WORKTREE_SUFFIX = /^--worktrees-\d{3}-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/;

/** A sub-agent transcript's file name and the meta file beside it. */
const SUBAGENT_FILE = /^(agent-.+)\.jsonl$/;

/** A transcript folder that cannot be listed: the run has nothing to measure, so the command ends with exit 1. */
export class TranscriptFolderError extends Error {
  constructor(readonly code: string) {
    super(`the transcript folder cannot be read (${code})`);
  }
}

/** A project path as Claude Code names its folder under `projects/`: every character but a letter or digit is `-`. */
export function encodeProjectPath(path: string): string {
  return path.replace(/[^A-Za-z0-9]/g, "-");
}

/** Claude Code's config directory: `$CLAUDE_CONFIG_DIR` when set and not empty, `~/.claude` otherwise. */
export function claudeConfigDir(env: Env, home: string = homedir()): string {
  const configured = env.CLAUDE_CONFIG_DIR;
  return configured !== undefined && configured !== "" ? configured : join(home, ".claude");
}

/** The project folder Claude Code keeps the sessions of the repository at `root` in. */
export function defaultTranscriptFolder(root: string, env: Env, home: string = homedir()): string {
  return join(claudeConfigDir(env, home), "projects", encodeProjectPath(root));
}

/** Byte order, so the file lists never depend on locale or `readdir` order. */
export function byteOrder(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a), Buffer.from(b));
}

function sortedEntries(dir: string): Dirent[] {
  return listEntries(dir).sort((a, b) => byteOrder(a.name, b.name));
}

export interface TranscriptDiscovery {
  readonly files: TranscriptFile[];
  readonly diagnostics: TokenDiagnostic[];
}

/**
 * Every transcript of the project folder `folder` and of its agent and spec worktrees' sibling folders, in a fixed
 * order: the folder's entries in byte order (a session's sub-agent folder `<session>` sorts before its
 * `<session>.jsonl`), then each sibling folder in byte order, a spec worktree's entries (`<folder>--worktrees-NNN-slug`
 * or `<folder>-NNN`) read the same way as the folder's. Labels are paths relative to `folder`. Throws
 * `TranscriptFolderError` when `folder` itself cannot be listed.
 */
export function discoverTranscripts(folder: string): TranscriptDiscovery {
  let entries: Dirent[];
  try {
    entries = sortedEntries(folder);
  } catch (error) {
    throw new TranscriptFolderError(unreadableCode(error));
  }
  const files: TranscriptFile[] = [];
  const diagnostics: TokenDiagnostic[] = [];
  const read = (path: string, label: string): string | null => {
    try {
      return readText(path);
    } catch (error) {
      diagnostics.push({
        severity: "warning",
        code: "tokens-transcript-unreadable",
        message: `The transcript cannot be read (${unreadableCode(error)}); it is not measured.`,
        source: label,
      });
      return null;
    }
  };

  files.push(...sessionsOf(folder, entries, "", read));

  const parent = dirname(folder);
  const base = basename(folder);
  const prefix = `${base}${WORKTREE_INFIX}`;
  const isSpecWorktree = (name: string): boolean => {
    if (!name.startsWith(base)) return false;
    const rest = name.slice(base.length);
    return SPEC_WORKTREE_SUFFIX.test(rest) || IN_REPO_SPEC_WORKTREE_SUFFIX.test(rest);
  };
  let siblings: Dirent[] = [];
  try {
    siblings = sortedEntries(parent);
  } catch (error) {
    diagnostics.push({
      severity: "warning",
      code: "tokens-worktrees-unreadable",
      message: `The folder holding the agent worktrees' transcripts cannot be listed (${unreadableCode(error)}); they are not measured.`,
    });
  }
  for (const sibling of siblings) {
    if (!sibling.isDirectory()) continue;
    const specWorktree = isSpecWorktree(sibling.name);
    if (!specWorktree && (!sibling.name.startsWith(prefix) || !WORKTREE_ID.test(sibling.name.slice(prefix.length)))) continue;
    const dir = join(parent, sibling.name);
    let inner: Dirent[];
    try {
      inner = sortedEntries(dir);
    } catch (error) {
      diagnostics.push({
        severity: "warning",
        code: "tokens-transcript-unreadable",
        message: `The worktree's transcript folder cannot be listed (${unreadableCode(error)}); it is not measured.`,
        source: `../${sibling.name}`,
      });
      continue;
    }
    if (specWorktree) {
      files.push(...sessionsOf(dir, inner, `../${sibling.name}/`, read));
      continue;
    }
    for (const entry of inner) {
      if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
      const label = `../${sibling.name}/${entry.name}`;
      const text = read(join(dir, entry.name), label);
      if (text !== null) files.push({ role: "worktree", session: entry.name.slice(0, -".jsonl".length), label, text });
    }
  }
  return { files, diagnostics };
}

/**
 * The main sessions of one project folder (the repository's own or a spec worktree's) and their sub-agents, from its
 * entries in byte order; `prefix` goes before every label (`""` for the folder itself, `../<sibling>/` otherwise).
 */
function sessionsOf(folder: string, entries: readonly Dirent[], prefix: string, read: (path: string, label: string) => string | null): TranscriptFile[] {
  const files: TranscriptFile[] = [];
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      const label = `${prefix}${entry.name}`;
      const text = read(join(folder, entry.name), label);
      if (text !== null) files.push({ role: "main", session: entry.name.slice(0, -".jsonl".length), label, text });
    } else if (entry.isDirectory()) {
      files.push(...subagentsOf(folder, entry.name, prefix, read));
    }
  }
  return files;
}

/** The sub-agent transcripts of the session `session`, each with the `toolUseId` of its meta file or null. */
function subagentsOf(folder: string, session: string, prefix: string, read: (path: string, label: string) => string | null): TranscriptFile[] {
  const dir = join(folder, session, "subagents");
  let entries: Dirent[];
  try {
    entries = sortedEntries(dir);
  } catch {
    return []; // a session folder without sub-agents
  }
  const files: TranscriptFile[] = [];
  for (const entry of entries) {
    const match = SUBAGENT_FILE.exec(entry.name);
    if (!entry.isFile() || match === null) continue;
    const label = `${prefix}${session}/subagents/${entry.name}`;
    const text = read(join(dir, entry.name), label);
    if (text !== null) files.push({ role: "subagent", session, label, text, toolUseId: toolUseIdOf(join(dir, `${match[1] ?? ""}.meta.json`)) });
  }
  return files;
}

/** The `toolUseId` a sub-agent's `.meta.json` names; null when the file is missing, not JSON or carries none. */
function toolUseIdOf(path: string): string | null {
  try {
    const meta: unknown = JSON.parse(readText(path));
    const id = typeof meta === "object" && meta !== null ? (meta as { toolUseId?: unknown }).toolUseId : undefined;
    return typeof id === "string" && id !== "" ? id : null;
  } catch {
    return null;
  }
}
