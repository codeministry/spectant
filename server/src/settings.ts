/**
 * Server-side settings (T43, ISC-18.3; plan 001 § Interfaces, § Data Model). They live in the `setting` table of
 * `spectant.db` (see `db.ts`), one row per key with the value JSON-encoded, so a chosen theme survives a reload on a
 * different port: the port changes, the data directory does not (ISC-21). Deleting the database loses only these
 * preferences and the registry (ISC-7).
 *
 * `SettingsSchema` is the single source of truth: a key, its default and its validator. Spec 002 appends a key
 * (`railCollapsed`, `termHints`, …) with one line here; storage, merging, validation and the HTTP layer follow.
 * The `setting` table also holds `schema_version`, which belongs to the migration: it is not in the schema, so it is
 * never returned and a `set` naming it fails with `unknown-key`.
 */
import type { Database } from "bun:sqlite";
import { type ApiHandler, matchesIfNoneMatch } from "./http.ts";

/** One setting: the value a fresh install gets, and the check every stored or submitted value must pass. */
export type SettingSpec<T> = { readonly default: T; readonly validate: (value: unknown) => value is T };

const oneOf =
  <const T extends string>(...values: T[]) =>
  (value: unknown): value is T =>
    typeof value === "string" && (values as string[]).includes(value);

const integerIn =
  (min: number, max: number) =>
  (value: unknown): value is number =>
    Number.isInteger(value) && (value as number) >= min && (value as number) <= max;

const isBoolean = (value: unknown): value is boolean => typeof value === "boolean";

/** Key → default and validator. Add a key with one line; `Settings` and the API follow from it. */
export const SettingsSchema = {
  theme: { default: "system", validate: oneOf("system", "light", "dark") },
  language: { default: "en", validate: oneOf("en", "de") },
  refreshSeconds: { default: 30, validate: integerIn(5, 3600) },
  singleKeyShortcuts: { default: true, validate: isBoolean },
  /** Spec 002, ISC-75: the context rail at wide shows as its 48 px strip. */
  railCollapsed: { default: false, validate: isBoolean },
  /** Spec 002, ISC-95: the Notes area's import notice was dismissed. */
  notesImportDismissed: { default: false, validate: isBoolean },
} as const satisfies Record<string, SettingSpec<unknown>>;

type Schema = typeof SettingsSchema;
export type SettingKey = keyof Schema;
export type Settings = { [K in SettingKey]: Schema[K]["validate"] extends (value: unknown) => value is infer T ? T : never };

const KEYS = Object.keys(SettingsSchema) as SettingKey[];

export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze(
  Object.fromEntries(KEYS.map((key) => [key, SettingsSchema[key].default])) as Settings,
);

export type SettingsErrorCode = "unknown-key" | "invalid-value";

/** A refused update. `code` and `key` are stable for callers; the HTTP layer returns them as `{error, key}`. */
export class SettingsError extends Error {
  constructor(
    readonly code: SettingsErrorCode,
    readonly key: string,
  ) {
    super(`${code}: ${key}`);
    this.name = "SettingsError";
  }
}

export type SettingsStore = {
  /** Every setting, stored values merged over the defaults. A stored value that fails its validator reads as the default. */
  get(): Settings;
  /** Validates the whole partial first, then writes it in one transaction and returns the full settings. */
  set(partial: Record<string, unknown>): Settings;
};

function isKey(key: string): key is SettingKey {
  return Object.hasOwn(SettingsSchema, key);
}

function decode(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/** Settings over an open, migrated `spectant.db` connection. The caller owns the connection and closes it. */
export function openSettings(db: Database): SettingsStore {
  const selectAll = db.query<{ key: string; value: string }, []>("SELECT key, value FROM setting");
  const upsert = db.query<null, [string, string]>(
    "INSERT INTO setting (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
  );

  const get = (): Settings => {
    const settings: Record<string, unknown> = { ...DEFAULT_SETTINGS };
    for (const { key, value } of selectAll.all()) {
      if (!isKey(key)) continue; // schema_version, or a key a newer build wrote
      const decoded = decode(value);
      if (SettingsSchema[key].validate(decoded)) settings[key] = decoded;
    }
    return settings as Settings;
  };

  const write = db.transaction((entries: Array<[SettingKey, unknown]>) => {
    for (const [key, value] of entries) upsert.run(key, JSON.stringify(value));
  });

  return {
    get,
    set(partial) {
      const entries = Object.entries(partial).map(([key, value]): [SettingKey, unknown] => {
        if (!isKey(key)) throw new SettingsError("unknown-key", key);
        if (!SettingsSchema[key].validate(value)) throw new SettingsError("invalid-value", key);
        return [key, value];
      });
      write.immediate(entries);
      return get();
    },
  };
}

/** The route this module answers. */
export const SETTINGS_PATH = "/api/settings";

const ALLOW = "GET, HEAD, PUT";
const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** True for a loopback `host[:port]`. The server binds loopback only; a foreign name here means DNS rebinding. */
export function isLoopbackHost(host: string | null): boolean {
  if (host === null) return false;
  try {
    return LOOPBACK_HOSTNAMES.has(new URL(`http://${host}`).hostname);
  } catch {
    return false;
  }
}

/** A browser sends `Origin` on a cross-origin request; it must be a loopback page too. Absent means a non-browser client. */
export function isLoopbackOrigin(origin: string | null): boolean {
  if (origin === null) return true;
  try {
    const url = new URL(origin);
    return url.protocol === "http:" && LOOPBACK_HOSTNAMES.has(url.hostname);
  } catch {
    return false;
  }
}

function etagFor(body: string): string {
  return `W/"${Bun.hash(body).toString(36)}"`;
}

function json(status: number, value: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers },
  });
}

function settingsResponse(settings: Settings, req: Request): Response {
  const body = JSON.stringify(settings);
  const headers = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-cache", ETag: etagFor(body) };
  if (req.method !== "PUT" && matchesIfNoneMatch(req.headers.get("If-None-Match"), headers.ETag)) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(req.method === "HEAD" ? null : body, { headers });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * `GET` / `HEAD` / `PUT /api/settings` as an `ApiHandler` for `serve({ api })`; `null` for any other path, so the
 * server's JSON 404 applies. Responses carry settings values and error codes only, never a path (ISC-3).
 */
export function settingsApi(store: SettingsStore): ApiHandler {
  const put = async (req: Request): Promise<Response> => {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return json(400, { error: "invalid-body" });
    }
    if (!isPlainObject(body)) return json(400, { error: "invalid-body" });
    try {
      return settingsResponse(store.set(body), req);
    } catch (error) {
      if (error instanceof SettingsError) return json(400, { error: error.code, key: error.key });
      throw error;
    }
  };

  return (req, url) => {
    if (url.pathname !== SETTINGS_PATH) return null;
    if (!isLoopbackHost(req.headers.get("Host")) || !isLoopbackOrigin(req.headers.get("Origin"))) {
      return json(403, { error: "forbidden" });
    }
    if (req.method === "GET" || req.method === "HEAD") return settingsResponse(store.get(), req);
    if (req.method === "PUT") return put(req);
    return json(405, { error: "method-not-allowed" }, { Allow: ALLOW });
  };
}
