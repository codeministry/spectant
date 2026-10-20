/**
 * The image store of the settings page (spec 016, T7, ISC-310): a workspace's logo and screenshot, each one file
 * `<kind>.<ext>` under `<data>/workspaces/<slug>/` in the app's data folder, never in a registered repository
 * (ISC-308). Deleting the data folder drops them with the registry (ISC-7).
 *
 * - The folder comes from the registry's slug alone, never from a request: the caller looks the slug up first. A slug
 *   that could name another folder (`.`, `..`, a separator) holds no image, and a stored file whose real path leaves
 *   `<data>/workspaces/<slug>/` (a symlink planted there) is never read and is replaced, not followed, on the next write.
 * - The type is the one `sniffImageType` decided on upload and the extension says; a new upload of a kind removes the
 *   kind's file of any other type, so each kind has at most one file.
 * - The version is the first 16 hex characters of the bytes' sha256, as the e2e stub computes it, so a new upload gets
 *   a new `imageUrl` and the browser reloads it. It is kept per file while size and mtime stand, so the list route does
 *   not hash every image on every poll.
 *
 * - `remove` deletes the slug's folder as one entry of `<data>/workspaces/`: a planted symlink in its place is unlinked,
 *   never followed, so nothing outside the data folder is ever deleted (ISC-307).
 *
 * No answer built from here carries an absolute path: `imagesOf` returns loopback URLs only.
 */
import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { join, sep } from "node:path";
import {
  IMAGE_TYPES,
  type ImageKind,
  type ImageTypeName,
  type WorkspaceImages,
  workspaceAdminRoutes,
} from "./workspace-admin.contract.ts";

export interface StoredImage {
  readonly type: ImageTypeName;
  readonly bytes: Uint8Array;
  readonly version: string;
}

export interface WorkspaceImageStore {
  /** The image URLs of one workspace as a summary lists them: `imageUrl` with the stored version, or null per kind. */
  readonly imagesOf: (slug: string) => WorkspaceImages;
  /** The stored image of one kind, or null when there is none (or it is no plain file inside the folder). */
  readonly read: (slug: string, kind: ImageKind) => StoredImage | null;
  /** Stores `bytes` of the sniffed `type` as the kind's one file and returns its version. */
  readonly write: (slug: string, kind: ImageKind, type: ImageTypeName, bytes: Uint8Array) => string;
  /** Deletes the workspace's image folder with every file in it; nothing when there is none. */
  readonly remove: (slug: string) => void;
}

const TYPE_NAMES = Object.keys(IMAGE_TYPES) as ImageTypeName[];

/** The version of an image: the first 16 hex characters of its sha256, as the e2e stub has it. */
export function imageVersion(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex").slice(0, 16);
}

/** A slug that names exactly one folder below `workspaces/`. Registry slugs are basenames and always are. */
function isFolderName(slug: string): boolean {
  return slug !== "" && slug !== "." && slug !== ".." && !slug.includes("/") && !slug.includes("\\") && !slug.includes("\0");
}

/** Opens the store over `dataDir` (`paths.ts` `dataDir()`); nothing is created until the first write. */
export function openImageStore(dataDir: string): WorkspaceImageStore {
  const base = join(dataDir, "workspaces");
  const versions = new Map<string, { size: number; mtimeMs: number; version: string }>();

  const folderOf = (slug: string): string | null => (isFolderName(slug) ? join(base, slug) : null);

  /** `<folder>/<kind>.<ext>` when it is a plain file whose real path stays inside the slug's folder, else null. */
  const fileOf = (slug: string, kind: ImageKind, type: ImageTypeName): { path: string; size: number; mtimeMs: number } | null => {
    const folder = folderOf(slug);
    if (folder === null) return null;
    const path = join(folder, `${kind}.${IMAGE_TYPES[type].ext}`);
    try {
      const stat = lstatSync(path);
      if (!stat.isFile()) return null;
      const realFolder = realpathSync(folder);
      const realBase = realpathSync(base);
      if (!realFolder.startsWith(realBase + sep) || !realpathSync(path).startsWith(realFolder + sep)) return null;
      return { path, size: stat.size, mtimeMs: stat.mtimeMs };
    } catch {
      return null;
    }
  };

  const find = (slug: string, kind: ImageKind): { type: ImageTypeName; path: string; size: number; mtimeMs: number } | null => {
    for (const type of TYPE_NAMES) {
      const file = fileOf(slug, kind, type);
      if (file !== null) return { type, ...file };
    }
    return null;
  };

  const versionOf = (file: { path: string; size: number; mtimeMs: number }, bytes?: Uint8Array): string => {
    const known = versions.get(file.path);
    if (known?.size === file.size && known.mtimeMs === file.mtimeMs) return known.version;
    const version = imageVersion(bytes ?? readFileSync(file.path));
    versions.set(file.path, { size: file.size, mtimeMs: file.mtimeMs, version });
    return version;
  };

  return {
    imagesOf(slug) {
      const urlOf = (kind: ImageKind): string | null => {
        const file = find(slug, kind);
        if (file === null) return null;
        try {
          return workspaceAdminRoutes.imageUrl(slug, kind, versionOf(file));
        } catch {
          return null;
        }
      };
      return { logo: urlOf("logo"), screenshot: urlOf("screenshot") };
    },
    read(slug, kind) {
      const file = find(slug, kind);
      if (file === null) return null;
      try {
        const bytes = new Uint8Array(readFileSync(file.path));
        return { type: file.type, bytes, version: versionOf(file, bytes) };
      } catch {
        return null;
      }
    },
    write(slug, kind, type, bytes) {
      const folder = folderOf(slug);
      if (folder === null) throw new Error("no image folder for this workspace");
      mkdirSync(folder, { recursive: true, mode: 0o700 });
      const realBase = realpathSync(base);
      if (!realpathSync(folder).startsWith(realBase + sep)) throw new Error("the image folder leaves the data folder");
      // Remove the kind's file of every type first (a planted symlink included, never its target), then create the
      // new one exclusively, so the write never follows a link.
      for (const other of TYPE_NAMES) {
        const path = join(folder, `${kind}.${IMAGE_TYPES[other].ext}`);
        rmSync(path, { force: true });
        versions.delete(path);
      }
      const path = join(folder, `${kind}.${IMAGE_TYPES[type].ext}`);
      writeFileSync(path, bytes, { flag: "wx", mode: 0o600 });
      return imageVersion(bytes);
    },
    remove(slug) {
      const folder = folderOf(slug);
      if (folder === null) return;
      let stat: ReturnType<typeof lstatSync>;
      try {
        stat = lstatSync(folder);
      } catch {
        return;
      }
      // A link in the folder's place goes alone, its target stays; a folder goes whole, and `rmSync` never follows a
      // link inside it.
      if (stat.isDirectory()) rmSync(folder, { recursive: true, force: true });
      else unlinkSync(folder);
      for (const path of versions.keys()) if (path.startsWith(folder + sep)) versions.delete(path);
    },
  };
}
