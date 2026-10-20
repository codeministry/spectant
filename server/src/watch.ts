/**
 * The file watcher behind the live update stream (spec 030, ISC-28; plan 030 § Approach): it watches the files every
 * read route reads per registered repository and reports, per workspace, which specs changed.
 *
 * Watched per base, the main checkout and each live spec worktree inside the repository (`readWorktreeView`):
 *
 * - `specs/`, recursively: every spec folder, `specs/archive/`, the stories and the repository files under `specs/`;
 * - the base itself, not recursively, for `ISA.md`: a directory, never the file, so an editor's write-and-rename still
 *   reports, and a `specs/` or `.spectant/` that appears later re-arms the watchers;
 * - `.spectant/`, not recursively, for `activity.jsonl` (the lock source, the run lines of spec 040, the steps of 015).
 *
 * The first change of a workspace starts a `SETTLE_MS` window; every change inside it is folded in, and one `LiveChange`
 * per workspace goes out at its end, with the ids `specIdOfPath` read from the paths (`core/`'s folder rule, no second
 * one here). A change whose file name the platform did not report changes no spec id but still counts.
 *
 * Watchers exist only while someone listens: the first `subscribe` arms them, the last unsubscribe closes them all.
 * `sync()` matches them to the registry and the worktrees as they stand; the stream calls it on every connect and
 * heartbeat, so a workspace or a spec worktree added meanwhile is watched within one heartbeat.
 *
 * Read-only: `fs.watch` opens the directories for reading and writes nothing (`tests/readonly.test.ts -t live`).
 */
import type { Database } from "bun:sqlite";
import { type FSWatcher, existsSync, watch } from "node:fs";
import { join } from "node:path";
import { listSpecs, specIdOfPath } from "../../core/src/resolve.ts";
import { pruneFavorites } from "./db.ts";
import type { Registry } from "./registry.ts";
import { readWorktreeView } from "./workspace-loader.ts";

/**
 * The favourites' share of the workspace scan (spec 057 T1, ISC-352): after a watcher change of workspace `ws`, every
 * `spec_favorite` row whose spec the main checkout no longer has as an open folder under `specs/` (archived under
 * `specs/archive/`, or gone) and no live spec worktree carries as its own folder (`readWorktreeView`'s `worktreeOnly`,
 * spec 039) is deleted, so a spec brought back from the archive carries no old star. The live stream runs it before
 * each build (`eventsApi`'s `scan`); no GET handler calls it (ISC-353). A workspace whose `specs/` cannot be listed
 * (not there, mid-checkout, unmounted) prunes nothing: an unreadable tree is no proof a spec left.
 */
export function favoritesScan(options: {
  readonly db: Database;
  readonly registry: Pick<Registry, "get">;
}): (change: LiveChange) => Promise<void> {
  return async (change) => {
    const workspace = options.registry.get(change.ws);
    if (workspace === undefined) return;
    const specsDir = join(workspace.path, "specs");
    if (!existsSync(specsDir)) return;
    let open: string[];
    try {
      const listed = listSpecs(workspace.path);
      const { worktreeOnly } = await readWorktreeView(workspace.path, listed);
      open = [...listed.flatMap((ref) => (ref.archived ? [] : [ref.slug])), ...worktreeOnly.map((ref) => ref.slug)];
    } catch {
      return;
    }
    // `listSpecs` reads a missing `specs/` as no specs at all; one removed during the read must not empty the set.
    if (!existsSync(specsDir)) return;
    pruneFavorites(options.db, change.ws, open);
  };
}

/** How long a workspace's changes are collected before they go out as one `LiveChange`. */
export const SETTLE_MS = 150;

/** One workspace's changes of one settle window. */
export interface LiveChange {
  readonly ws: string;
  /** The ids (`NNN`) of the spec folders a changed path lay in, in number order; empty when none did. */
  readonly specIds: readonly string[];
}

export type LiveListener = (change: LiveChange) => void;

/** `fs.watch` with the options this module passes, injectable so a test can drive the events. */
export type WatchFn = (
  dir: string,
  options: { recursive: boolean; persistent: boolean },
  listener: (event: string, filename: string | null) => void,
) => FSWatcher;

export interface WatchHub {
  /** Starts listening; the first listener arms the watchers. Returns the unsubscribe, which closes them after the last. */
  subscribe(listener: LiveListener): () => void;
  /** Re-reads the registry and the spec worktrees and arms or closes watchers to match; a no-op without listeners. */
  sync(): Promise<void>;
  /**
   * Syncs now and reports `ws` as changed to every listener at once, without a settle window and without a spec id:
   * after a registry write (spec 016) the stream sends the workspace list without waiting for a heartbeat or a file
   * change. A no-op without listeners.
   */
  announce(ws: string): Promise<void>;
}

export interface WatchHubOptions {
  readonly registry: Pick<Registry, "list">;
  readonly settleMs?: number;
  readonly watchFn?: WatchFn;
  /** The live spec worktrees' folders of a checkout, absolute; `readWorktreeView` by default. */
  readonly worktreesOf?: (root: string) => Promise<readonly string[]>;
}

/** One armed directory: what is watched, and how a reported file name maps to a repository path. */
interface Target {
  readonly ws: string;
  readonly dir: string;
  readonly recursive: boolean;
  /** The repository path of a reported name, or null when the name is none of this target's files. */
  readonly pathOf: (name: string) => string | null;
}

const targetsOf = (ws: string, base: string): Target[] => [
  { ws, dir: join(base, "specs"), recursive: true, pathOf: (name) => `specs/${name}` },
  {
    ws,
    dir: base,
    recursive: false,
    pathOf: (name) => (name === "ISA.md" || name === "specs" || name === ".spectant" ? name : null),
  },
  { ws, dir: join(base, ".spectant"), recursive: false, pathOf: (name) => `.spectant/${name}` },
];

const keyOf = (target: Target): string => `${target.ws}\0${target.dir}\0${target.recursive ? "r" : "-"}`;

/** The live spec worktrees inside the repository, as `readWorktreeView` lists them; none when git cannot say. */
async function specWorktrees(root: string): Promise<readonly string[]> {
  try {
    const { view } = await readWorktreeView(root);
    return view.live.flatMap((w) => (w.kind === "spec" && w.path !== null ? [join(root, w.path)] : []));
  } catch {
    return [];
  }
}

export function createWatchHub(options: WatchHubOptions): WatchHub {
  const settleMs = options.settleMs ?? SETTLE_MS;
  const watchFn: WatchFn = options.watchFn ?? ((dir, opts, listener) => watch(dir, opts, listener));
  const worktreesOf = options.worktreesOf ?? specWorktrees;
  const listeners = new Set<LiveListener>();
  const armed = new Map<string, FSWatcher>();
  const pending = new Map<string, { specIds: Set<string>; timer: ReturnType<typeof setTimeout> }>();
  let syncing: Promise<void> | null = null;

  const emit = (ws: string): void => {
    const entry = pending.get(ws);
    pending.delete(ws);
    if (entry === undefined) return;
    const change: LiveChange = { ws, specIds: [...entry.specIds].sort() };
    for (const listener of listeners) listener(change);
  };

  const note = (target: Target, filename: string | null): void => {
    const path = filename === null ? null : target.pathOf(filename);
    if (filename !== null && path === null) return;
    if (path === "specs" || path === ".spectant") void hub.sync();
    let entry = pending.get(target.ws);
    if (entry === undefined) {
      entry = { specIds: new Set(), timer: setTimeout(() => emit(target.ws), settleMs) };
      pending.set(target.ws, entry);
    }
    const id = path === null ? null : specIdOfPath(path);
    if (id !== null) entry.specIds.add(id);
  };

  const arm = (target: Target): void => {
    if (!existsSync(target.dir)) return;
    try {
      const watcher = watchFn(target.dir, { recursive: target.recursive, persistent: false }, (_event, filename) =>
        note(target, filename),
      );
      // A watched directory that goes away (a removed worktree) errors once; the next sync drops or re-arms it.
      watcher.on("error", () => {
        watcher.close();
        armed.delete(keyOf(target));
      });
      armed.set(keyOf(target), watcher);
    } catch {
      // Unreadable or vanished between the check and the watch: the poll still covers it, the next sync retries.
    }
  };

  const closeAll = (): void => {
    for (const watcher of armed.values()) watcher.close();
    armed.clear();
    for (const entry of pending.values()) clearTimeout(entry.timer);
    pending.clear();
  };

  const syncNow = async (): Promise<void> => {
    const wanted = new Map<string, Target>();
    for (const workspace of options.registry.list()) {
      const bases = [workspace.path, ...(await worktreesOf(workspace.path))];
      for (const base of bases) for (const target of targetsOf(workspace.slug, base)) wanted.set(keyOf(target), target);
    }
    if (listeners.size === 0) return;
    for (const [key, watcher] of armed) {
      if (wanted.has(key)) continue;
      watcher.close();
      armed.delete(key);
    }
    for (const [key, target] of wanted) if (!armed.has(key)) arm(target);
  };

  const hub: WatchHub = {
    subscribe(listener) {
      listeners.add(listener);
      void hub.sync();
      return () => {
        if (!listeners.delete(listener) || listeners.size > 0) return;
        closeAll();
      };
    },
    sync() {
      if (listeners.size === 0) return Promise.resolve();
      // One sync at a time; a call during one waits for it and then runs once more, so nothing it saw is missed.
      const next = (syncing ?? Promise.resolve()).then(syncNow, syncNow).finally(() => {
        if (syncing === next) syncing = null;
      });
      syncing = next;
      return next;
    },
    async announce(ws) {
      await hub.sync();
      const change: LiveChange = { ws, specIds: [] };
      for (const listener of listeners) listener(change);
    },
  };
  return hub;
}
