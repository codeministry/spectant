// Demo guard, the static half of ISC-149.1 (spec 024): a mocked element reads only its fixture, writes nothing and
// calls no host. Everything under `web/src/app/shared/demo/` must
//
// - import nothing but `@angular/core` and its own files (no `ApiClient`, no `HttpClient`, no other app module);
// - name no network primitive (`fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `sendBeacon`) and no storage
//   write;
// - declare no method, function or export named like a write (`write`, `save`, `put`, `post`, `delete`, `update`, …);
//
// and no file outside the folder imports a fixture module directly: features go through `DemoData`
// (`shared/demo/demo-data.ts`). The e2e half (no write, no non-loopback request from a mock) is `web/e2e/demo.spec.ts`
// (T47).
import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const SRC = join(import.meta.dir, "..", "src");
const DEMO = join(SRC, "app", "shared", "demo");

function files(dir: string, keep: (name: string) => boolean): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return files(path, keep);
    return keep(entry.name) ? [path] : [];
  });
}

/** The folder's code, specs excluded (a spec may use TestBed helpers; it ships nothing). */
const demoSources = (): string[] =>
  files(DEMO, (name) => name.endsWith(".ts") && !name.endsWith(".spec.ts"));

/** Source without comments, so the header prose may name what it rules out. */
const code = (path: string): string =>
  readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:'"`])\/\/.*$/gm, "$1");

const specifiers = (source: string): string[] =>
  [
    ...source.matchAll(
      /\b(?:import|export)\b[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]/g,
    ),
  ].map((match) => match[1] ?? match[2] ?? "");

const WRITE_NAME =
  /^(write|save|put|post|patch|delete|remove|update|upsert|create|upload|send|store|persist|set)/i;
const NETWORK =
  /\b(fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|HttpClient|ApiClient|HttpBackend)\b/;
/**
 * Callable or exported names: a method or function (`name(`, `name<T>(`), an arrow bound to a const or let, or any
 * exported binding. Data fields (`updated: …` in a fixture) are not callables and pass.
 */
const DECLARED = [
  /^\s*(?:(?:export|async|static|public|protected|private|readonly|function)\s+)*([A-Za-z_$][\w$]*)\s*(?:<[^>\n]*>)?\s*\(/gm,
  /\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]*)?=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/g,
  /\bexport\s+(?:default\s+)?(?:abstract\s+)?(?:const|let|var|function|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g,
];
const declaredNames = (source: string): string[] =>
  DECLARED.flatMap((pattern) =>
    [...source.matchAll(pattern)].map((match) => match[1] ?? ""),
  );
const STORAGE_WRITE =
  /\b(localStorage|sessionStorage|indexedDB)\b|\bdocument\.cookie\b/;

describe("shared/demo is read-only and host-free (ISC-149.1)", () => {
  test("the folder exists and exports the one read service", () => {
    expect(existsSync(join(DEMO, "demo-data.ts"))).toBe(true);
    expect(code(join(DEMO, "demo-data.ts"))).toMatch(/export class DemoData\b/);
  });

  test("imports only @angular/core and its own files", () => {
    const offenders = demoSources().flatMap((path) =>
      specifiers(code(path))
        .filter((spec) => spec !== "@angular/core" && !spec.startsWith("./"))
        .map((spec) => `${relative(SRC, path)}: ${spec}`),
    );
    expect(offenders).toEqual([]);
  });

  test("names no network primitive and no storage write", () => {
    const offenders = demoSources().flatMap((path) => {
      const source = code(path);
      return [NETWORK.exec(source)?.[0], STORAGE_WRITE.exec(source)?.[0]]
        .filter((hit): hit is string => hit !== undefined)
        .map((hit) => `${relative(SRC, path)}: ${hit}`);
    });
    expect(offenders).toEqual([]);
  });

  test("declares no method, function or export named like a write", () => {
    const offenders = demoSources().flatMap((path) =>
      declaredNames(code(path))
        .filter((name) => WRITE_NAME.test(name))
        .map((name) => `${relative(SRC, path)}: ${name}`),
    );
    expect(offenders).toEqual([]);
  });

  test("no file outside the folder imports a fixture module", () => {
    const outside = files(SRC, (name) => name.endsWith(".ts")).filter(
      (path) => !path.startsWith(DEMO),
    );
    const offenders = outside.flatMap((path) =>
      specifiers(code(path))
        .filter((spec) =>
          /shared\/demo\/fixtures\b|\/demo\/fixtures\//.test(spec),
        )
        .map((spec) => `${relative(SRC, path)}: ${spec}`),
    );
    expect(offenders).toEqual([]);
  });

  test("the guard bites: a write method and an ApiClient import are caught", () => {
    const sample =
      "import { ApiClient } from '../../core/api.service';\nexport class X {\n  save(): void {}\n}\n";
    expect(specifiers(sample)).toEqual(["../../core/api.service"]);
    expect(NETWORK.test(sample)).toBe(true);
    expect(
      declaredNames(sample).filter((name) => WRITE_NAME.test(name)),
    ).toEqual(["save"]);
  });
});
