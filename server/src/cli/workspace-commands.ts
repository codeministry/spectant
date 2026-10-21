/**
 * The workspace commands `add`, `list` and `remove` (T44, ISC-13). They work on the registry in the data directory from
 * `infra/paths.ts` (`$XDG_DATA_HOME/spectant` or `~/.spectant`). They print a workspace by its slug and its path tail
 * only, never its absolute path (ISC-3), and they never write into the repository itself (ISC-15). A relative path
 * resolves against the working directory.
 */
import { resolve } from "node:path";
import { openRegistry, type Registry, RegistryError } from "../infra/db/registry.ts";
import { realpathOrNull } from "../infra/fs/exists.ts";
import { dataDir } from "../infra/paths.ts";
import { pathTail } from "../workspace/index.ts";
import type { Command } from "./args.ts";
import type { RunOptions } from "./options.ts";

/** The stored paths `ref` could mean: its realpath when it exists, and the plain absolute path. */
function candidatePaths(absolute: string): string[] {
  const real = realpathOrNull(absolute);
  return real === null ? [absolute] : [real, absolute];
}

function add(registry: Registry, arg: string, cwd: string): number {
  const absolute = resolve(cwd, arg);
  try {
    const workspace = registry.add(absolute);
    console.log(`added ${workspace.slug} · ${pathTail(workspace.path)}`);
    return 0;
  } catch (error) {
    if (!(error instanceof RegistryError)) throw error;
    if (error.code === "duplicate-path") {
      const paths = candidatePaths(absolute);
      const existing = registry.list().find((w) => paths.includes(w.path));
      console.error(`spectant: ${arg} is already registered as ${existing?.slug ?? "another workspace"}`);
    } else {
      console.error(`spectant: ${arg} is not a directory`);
    }
    return 1;
  }
}

function list(registry: Registry): number {
  const workspaces = registry.list();
  const width = Math.max(0, ...workspaces.map((w) => w.slug.length));
  for (const workspace of workspaces) console.log(`${workspace.slug.padEnd(width)}  ${pathTail(workspace.path)}`);
  return 0;
}

function remove(registry: Registry, ref: string, cwd: string): number {
  const paths = candidatePaths(resolve(cwd, ref));
  const workspace = registry.get(ref) ?? registry.list().find((w) => paths.includes(w.path));
  if (workspace === undefined || !registry.remove(workspace.slug)) {
    console.error(`spectant: ${ref} is not registered`);
    return 1;
  }
  console.log(`removed ${workspace.slug}`);
  return 0;
}

export function workspaceCommand(command: Command & { kind: "add" | "list" | "remove" }, options: RunOptions): number {
  const cwd = options.cwd ?? process.cwd();
  const registry = openRegistry(dataDir(options.env ?? process.env));
  try {
    switch (command.kind) {
      case "add":
        return add(registry, command.path, cwd);
      case "list":
        return list(registry);
      case "remove":
        return remove(registry, command.ref, cwd);
    }
  } finally {
    registry.close();
  }
}
