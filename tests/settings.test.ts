// Server-side settings (T43, ISC-18.3, ISC-7, ISC-21): the `setting` table behind `GET` / `PUT /api/settings`. Every
// test runs against a fresh temp data directory; nothing touches the real `~/.spectant`. The last suite is the
// server-level half of ISC-18.3: a value stored through one server is what a second server, on another port against
// the same data directory, returns after the first has stopped.
import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type EmbeddedManifest, embeddedAssetFor } from "../server/src/assets.contract.ts";
import { openDatabase } from "../server/src/db.ts";
import { type RunningServer, serve } from "../server/src/http.ts";
import {
  DEFAULT_SETTINGS,
  type Settings,
  SettingsError,
  SettingsSchema,
  openSettings,
  settingsApi,
} from "../server/src/settings.ts";

let root: string;
let data: string;
let db: Database | undefined;
const running: RunningServer[] = [];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "spectant-settings-"));
  data = join(root, "data");
});

afterEach(() => {
  for (const server of running.splice(0)) server.stop();
  db?.close();
  db = undefined;
  rmSync(root, { recursive: true, force: true });
});

function openDb(): Database {
  db?.close();
  db = openDatabase(data);
  return db;
}

/** A one-file manifest, the way `http.test.ts` builds one, so `serve` runs without a web build. */
function manifest(): EmbeddedManifest {
  const web = join(root, "web");
  mkdirSync(web, { recursive: true });
  writeFileSync(join(web, "index.html"), "<!doctype html><title>spectant</title>");
  return {
    generatedAt: "2026-09-29T10:00:00.000Z",
    assets: [{ ...embeddedAssetFor("index.html"), file: join(web, "index.html") }],
    index: join(web, "index.html"),
  };
}

function start(database: Database, port = 0): RunningServer {
  const server = serve({ manifest: manifest(), port, api: settingsApi(openSettings(database)) });
  running.push(server);
  return server;
}

function put(server: RunningServer, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${server.url}api/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("SettingsSchema", () => {
  test("holds exactly the plan's four keys, each default passing its own validator", () => {
    expect(Object.keys(SettingsSchema).sort()).toEqual(["language", "notesImportDismissed", "railCollapsed", "refreshSeconds", "singleKeyShortcuts", "theme"]);
    for (const [key, spec] of Object.entries(SettingsSchema)) {
      expect({ key, valid: spec.validate(spec.default) }).toEqual({ key, valid: true });
    }
    expect(DEFAULT_SETTINGS).toEqual({ theme: "system", language: "en", refreshSeconds: 30, singleKeyShortcuts: true, railCollapsed: false, notesImportDismissed: false });
  });

  test("the validators accept the plan's values and refuse everything else", () => {
    for (const theme of ["system", "light", "dark"]) expect(SettingsSchema.theme.validate(theme)).toBe(true);
    for (const theme of ["", "Dark", "auto", 1, null, undefined]) expect(SettingsSchema.theme.validate(theme)).toBe(false);
    for (const language of ["en", "de"]) expect(SettingsSchema.language.validate(language)).toBe(true);
    for (const language of ["fr", "EN", "de-DE", 0]) expect(SettingsSchema.language.validate(language)).toBe(false);
    for (const seconds of [5, 30, 3600]) expect(SettingsSchema.refreshSeconds.validate(seconds)).toBe(true);
    for (const seconds of [0, 4, 3601, 1.5, -30, Number.NaN, "30", null]) {
      expect(SettingsSchema.refreshSeconds.validate(seconds)).toBe(false);
    }
    for (const flag of [true, false]) expect(SettingsSchema.singleKeyShortcuts.validate(flag)).toBe(true);
    for (const flag of ["true", 1, 0, null]) expect(SettingsSchema.singleKeyShortcuts.validate(flag)).toBe(false);
    for (const flag of [true, false]) expect(SettingsSchema.railCollapsed.validate(flag)).toBe(true);
    for (const flag of ["false", 0, null]) expect(SettingsSchema.railCollapsed.validate(flag)).toBe(false);
    for (const flag of [true, false]) expect(SettingsSchema.notesImportDismissed.validate(flag)).toBe(true);
    for (const flag of ["true", 1, null]) expect(SettingsSchema.notesImportDismissed.validate(flag)).toBe(false);
  });
});

describe("openSettings", () => {
  test("a fresh database returns the defaults and writes no setting row besides the schema version", () => {
    const database = openDb();
    expect(openSettings(database).get()).toEqual(DEFAULT_SETTINGS);
    const keys = database.query<{ key: string }, []>("SELECT key FROM setting ORDER BY key").all();
    expect(keys.map((row) => row.key)).toEqual(["schema_version"]);
  });

  test("set merges a partial update, stores one row per key and returns the full settings", () => {
    const database = openDb();
    const settings = openSettings(database);
    const next = settings.set({ theme: "dark" });
    expect(next).toEqual({ ...DEFAULT_SETTINGS, theme: "dark" });
    expect(settings.set({ refreshSeconds: 60, language: "de" })).toEqual({
      ...DEFAULT_SETTINGS,
      theme: "dark",
      refreshSeconds: 60,
      language: "de",
    });
    const rows = database.query<{ key: string }, []>("SELECT key FROM setting WHERE key <> 'schema_version' ORDER BY key").all();
    expect(rows.map((row) => row.key)).toEqual(["language", "refreshSeconds", "theme"]);
  });

  test("the stored values survive closing and reopening the database", () => {
    openSettings(openDb()).set({ theme: "light", singleKeyShortcuts: false });
    expect(openSettings(openDb()).get()).toEqual({ ...DEFAULT_SETTINGS, theme: "light", singleKeyShortcuts: false });
  });

  test("an unknown key is refused with `unknown-key` and nothing is written", () => {
    const settings = openSettings(openDb());
    for (const key of ["colour", "schema_version", "__proto__", "toString"]) {
      let error: unknown;
      try {
        settings.set(JSON.parse(`{"theme":"dark",${JSON.stringify(key)}:"x"}`) as Record<string, unknown>);
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(SettingsError);
      expect({ code: (error as SettingsError).code, key: (error as SettingsError).key }).toEqual({ code: "unknown-key", key });
    }
    expect(settings.get()).toEqual(DEFAULT_SETTINGS);
  });

  test("a bad value is refused with `invalid-value` and the whole update is rolled back", () => {
    const settings = openSettings(openDb());
    settings.set({ theme: "light" });
    expect(() => settings.set({ theme: "dark", refreshSeconds: 0 })).toThrow(SettingsError);
    try {
      settings.set({ theme: "dark", language: "fr" });
    } catch (error) {
      expect({ code: (error as SettingsError).code, key: (error as SettingsError).key }).toEqual({
        code: "invalid-value",
        key: "language",
      });
    }
    expect(settings.get()).toEqual({ ...DEFAULT_SETTINGS, theme: "light" });
  });

  test("schema_version is never returned and a set cannot touch it", () => {
    const database = openDb();
    const settings = openSettings(database);
    expect(Object.keys(settings.get())).not.toContain("schema_version");
    expect(() => settings.set({ schema_version: "9" })).toThrow(SettingsError);
    const row = database.query<{ value: string }, []>("SELECT value FROM setting WHERE key = 'schema_version'").get();
    expect(row?.value).toBe("3");
  });

  test("a corrupt or out-of-range stored value falls back to its default", () => {
    const database = openDb();
    database.run("INSERT INTO setting (key, value) VALUES ('theme', 'not json'), ('refreshSeconds', '0'), ('language', '\"de\"')");
    expect(openSettings(database).get()).toEqual({ ...DEFAULT_SETTINGS, language: "de" });
  });
});

describe("/api/settings", () => {
  test("GET returns the defaults as JSON with an ETag, and 304 on a matching If-None-Match", async () => {
    const server = start(openDb());
    const res = await fetch(`${server.url}api/settings`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toStartWith("application/json");
    expect(res.headers.get("cache-control")).toBe("no-cache");
    const etag = res.headers.get("etag");
    expect(etag).toMatch(/^W\/"[^"]+"$/);
    expect((await res.json()) as Settings).toEqual(DEFAULT_SETTINGS);

    const again = await fetch(`${server.url}api/settings`, { headers: { "If-None-Match": etag ?? "" } });
    expect(again.status).toBe(304);
    expect(again.headers.get("etag")).toBe(etag);
  });

  test("PUT with a partial body answers 200 with the full settings and a new ETag", async () => {
    const server = start(openDb());
    const before = (await fetch(`${server.url}api/settings`)).headers.get("etag");
    const res = await put(server, { theme: "dark" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Settings;
    expect(body).toEqual({ ...DEFAULT_SETTINGS, theme: "dark" });
    expect(res.headers.get("etag")).not.toBe(before);
    expect((await (await fetch(`${server.url}api/settings`)).json()) as Settings).toEqual(body);
  });

  test("PUT with an invalid value answers 400 {error, key} and leaves the stored settings unchanged", async () => {
    const server = start(openDb());
    await put(server, { theme: "light" });
    const bad = await put(server, { theme: "dark", refreshSeconds: "fast" });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "invalid-value", key: "refreshSeconds" });

    const unknown = await put(server, { theme: "dark", schema_version: 7 });
    expect(unknown.status).toBe(400);
    expect(await unknown.json()).toEqual({ error: "unknown-key", key: "schema_version" });

    expect(await (await fetch(`${server.url}api/settings`)).json()).toEqual({ ...DEFAULT_SETTINGS, theme: "light" });
  });

  test("PUT with malformed JSON or a non-object body answers 400 invalid-body", async () => {
    const server = start(openDb());
    for (const body of ["{", "[]", "null", "\"dark\"", "42"]) {
      const res = await put(server, body);
      expect({ body, status: res.status }).toEqual({ body, status: 400 });
      expect(await res.json()).toEqual({ error: "invalid-body" });
    }
    expect(await (await fetch(`${server.url}api/settings`)).json()).toEqual(DEFAULT_SETTINGS);
  });

  test("a cross-site Origin or a non-loopback Host is refused with 403 and changes nothing", async () => {
    const server = start(openDb());
    const foreignOrigin = await put(server, { theme: "dark" }, { Origin: "https://evil.example" });
    expect(foreignOrigin.status).toBe(403);
    const sameOrigin = await put(server, { theme: "light" }, { Origin: server.url.replace(/\/$/, "") });
    expect(sameOrigin.status).toBe(200);
    // A DNS-rebinding page reaches 127.0.0.1 under its own host name; the Host header gives it away.
    const rebound = await fetch(`${server.url}api/settings`, { headers: { Host: "evil.example" } });
    expect(rebound.status).toBe(403);
    expect(await (await fetch(`${server.url}api/settings`)).json()).toEqual({ ...DEFAULT_SETTINGS, theme: "light" });
  });

  test("other methods answer 405 with Allow, other /api/ paths fall through to the JSON 404", async () => {
    const server = start(openDb());
    const post = await fetch(`${server.url}api/settings`, { method: "POST", body: "{}" });
    expect(post.status).toBe(405);
    expect(post.headers.get("allow")).toBe("GET, HEAD, PUT");
    const other = await fetch(`${server.url}api/settings/theme`);
    expect(other.status).toBe(404);
  });

  test("no response carries an absolute path (ISC-3)", async () => {
    const server = start(openDb());
    const bodies = [
      await (await fetch(`${server.url}api/settings`)).text(),
      await (await put(server, { theme: "dark" })).text(),
      await (await put(server, { nope: 1 })).text(),
      await (await put(server, "{")).text(),
    ];
    for (const body of bodies) {
      expect(body).not.toContain(root);
      expect(body).not.toContain(tmpdir());
    }
  });
});

describe("ISC-18.3 at the server level: a chosen mode survives a restart on another port", () => {
  test("the second server, on a different port against the same data directory, returns what the first stored", async () => {
    const first = start(openDb());
    const firstPort = first.port;
    expect((await put(first, { theme: "dark" })).status).toBe(200);
    running.splice(running.indexOf(first), 1);
    first.stop();
    db?.close();
    db = undefined;

    // A fresh ephemeral port is almost always a different one; retry the rare reuse so the case stays a port change.
    let second = start(openDb());
    for (let attempt = 0; second.port === firstPort && attempt < 5; attempt++) second = start(openDb());
    expect(second.port).not.toBe(firstPort);
    expect(await (await fetch(`${second.url}api/settings`)).json()).toEqual({ ...DEFAULT_SETTINGS, theme: "dark" });
  });

  test("the light mode survives the same restart, and the untouched keys keep their defaults", async () => {
    const first = start(openDb());
    const firstPort = first.port;
    await put(first, { theme: "dark" });
    await put(first, { theme: "light" });
    running.splice(running.indexOf(first), 1);
    first.stop();
    db?.close();
    db = undefined;

    let second = start(openDb());
    for (let attempt = 0; second.port === firstPort && attempt < 5; attempt++) second = start(openDb());
    expect(second.port).not.toBe(firstPort);
    const res = await fetch(`${second.url}api/settings`);
    expect(await res.json()).toEqual({ ...DEFAULT_SETTINGS, theme: "light" });
  });
});
