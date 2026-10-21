// Feature shape guard for spec 061 (ISC-436, ISC-437): Board, Library, Spec and Planning are each cut into page
// components, signal stores and part components fed through `input()` / `output()` / `model()`.
//
// - `-t store` (ISC-436): every file in STORES exists and declares an `@Injectable` class whose name ends in `Store`,
//   and none of them reaches a template or the DOM: no `@Component` / `@Directive`, no import of a template or DOM
//   handle from Angular (`Component`, `ElementRef`, `viewChild`, `DOCUMENT`, …), no use of the `document` or `window`
//   global. The fixture `store/dom.store.ts` reaches the DOM and is reported.
// - `-t pages` (ISC-437): under `features/{board,library,spec,planning}/`, a component that calls `inject()` on a
//   `*Store` class or on `ApiClient` is one of PAGES, the components that render a route, a tab, a planning lens or
//   the library's reader view. Services and stores are not checked; a part component may still inject the router,
//   the selection, the shell and the live sources. The fixture `pages/board/` holds a part component injecting a store
//   and one injecting `ApiClient`; both are reported, the listed page injecting both is not.
//
// The sources are read with the TypeScript parser, so a comment or a string that names a pattern is no hit.
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { walk } from "./sources";

/** The signal stores ISC-436 names, relative to `web/src/app/features/`: the contract the later rounds create. */
export const STORES = [
  "board/board.store.ts",
  "planning/planning.store.ts",
  "library/library.store.ts",
  "library/library-reader.store.ts",
  "spec/spec.store.ts",
  "spec/dashboard/dashboard.store.ts",
  "spec/status/status.store.ts",
  "spec/status/timeline/timeline.store.ts",
  "spec/data/claims/claims.store.ts",
  "spec/data/tasks/tasks.store.ts",
  "spec/notes/notes.store.ts",
  // The matrix tab provides its own instance of the live store; the live board has one of its own.
  "spec/live/live.store.ts",
  "spec/live/board/live-board.store.ts",
] as const;

/** The page components ISC-437 allows to inject a store or `ApiClient`, relative to `web/src/app/features/`. */
export const PAGES = [
  "board/board-page.ts",
  "library/library-page.ts",
  "library/library-reader.ts",
  "planning/planning-lens-page.ts",
  "planning/planning-tree/planning-tree.ts",
  "planning/planning-gantt/planning-gantt.ts",
  "planning/planning-graph/planning-graph.ts",
  "spec/spec-page.ts",
  "spec/dashboard/spec-dashboard.ts",
  "spec/status/status-tab.ts",
  "spec/status/timeline/timeline-tab.ts",
  "spec/data/claims/claims-tab.ts",
  "spec/data/tasks/tasks-tab.ts",
  "spec/notes/notes-area.ts",
  "spec/live/board/board-tab.ts",
  "spec/live/matrix/matrix-tab.ts",
] as const;

/** The areas ISC-437 holds to the page rule. */
const AREAS = ["board", "library", "spec", "planning"] as const;

const FEATURES = join(import.meta.dir, "..", "src", "app", "features");
const FIXTURES = join(import.meta.dir, "fixtures", "feature-shape");

/** What a store may not import from Angular: the handles of a template or of the DOM. */
const TEMPLATE_OR_DOM = new Set([
  "Component",
  "Directive",
  "TemplateRef",
  "ViewContainerRef",
  "ElementRef",
  "Renderer2",
  "ViewChild",
  "ViewChildren",
  "viewChild",
  "viewChildren",
  "ContentChild",
  "contentChild",
  "DOCUMENT",
]);

/** The browser globals a store may not touch. */
const DOM_GLOBALS = new Set(["document", "window"]);

const parse = (path: string): ts.SourceFile =>
  ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

/** Every node under `node`, depth first. */
function nodes(node: ts.Node): ts.Node[] {
  const out: ts.Node[] = [];
  const visit = (n: ts.Node): void => {
    out.push(n);
    ts.forEachChild(n, visit);
  };
  visit(node);
  return out;
}

/** The names of a class's decorators that are calls, such as `Component` for `@Component({…})`. */
const decorators = (node: ts.ClassDeclaration): string[] =>
  (ts.getDecorators(node) ?? []).flatMap((d) =>
    ts.isCallExpression(d.expression) && ts.isIdentifier(d.expression.expression) ? [d.expression.expression.text] : [],
  );

const lineOf = (source: ts.SourceFile, node: ts.Node): number =>
  source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;

/** An identifier read as a value: not a property name after a dot, not an object key, not a declared name. */
function isValueReference(id: ts.Identifier): boolean {
  const parent = id.parent;
  if (ts.isPropertyAccessExpression(parent) && parent.name === id) return false;
  if (ts.isPropertyAssignment(parent) && parent.name === id) return false;
  if (ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent)) return false;
  const declared = parent as ts.Node & { name?: ts.Node };
  return declared.name !== id;
}

/** Each way the store files under `root` miss the shape ISC-436 asks for, as `file[:line]: reason`. */
export function storeViolations(root: string, files: readonly string[]): string[] {
  return files.flatMap((file) => {
    const path = join(root, file);
    if (!existsSync(path)) return [`${file}: missing`];
    const source = parse(path);
    const out: string[] = [];
    const all = nodes(source);
    const classes = all.filter(ts.isClassDeclaration);
    if (!classes.some((c) => decorators(c).includes("Injectable") && (c.name?.text ?? "").endsWith("Store"))) {
      out.push(`${file}: no @Injectable class named *Store`);
    }
    for (const c of classes) {
      for (const name of decorators(c).filter((d) => d === "Component" || d === "Directive")) {
        out.push(`${file}:${lineOf(source, c)}: @${name} class ${c.name?.text ?? "(anonymous)"}`);
      }
    }
    for (const node of all) {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text.startsWith("@angular/")) {
        const bindings = node.importClause?.namedBindings;
        if (bindings === undefined || !ts.isNamedImports(bindings)) continue;
        for (const el of bindings.elements) {
          const imported = (el.propertyName ?? el.name).text;
          if (TEMPLATE_OR_DOM.has(imported)) out.push(`${file}:${lineOf(source, el)}: imports ${imported} from ${node.moduleSpecifier.text}`);
        }
      } else if (ts.isIdentifier(node) && DOM_GLOBALS.has(node.text) && isValueReference(node)) {
        out.push(`${file}:${lineOf(source, node)}: uses the ${node.text} global`);
      }
    }
    return out;
  });
}

/** The class an `inject()` call names: `X` for `inject(X)` and `inject<T>(X, {…})`. */
function injected(call: ts.CallExpression): string | undefined {
  if (!ts.isIdentifier(call.expression) || call.expression.text !== "inject") return undefined;
  const token = call.arguments[0];
  return token !== undefined && ts.isIdentifier(token) ? token.text : undefined;
}

const isStoreOrApi = (name: string): boolean => name === "ApiClient" || name.endsWith("Store");

/**
 * Each component under `root`'s `areas` that injects a `*Store` or `ApiClient` without being one of `pages`, as
 * `file:line: Class injects X`. Specs are skipped; services, stores and other classes are not checked.
 */
export function pageViolations(root: string, areas: readonly string[], pages: readonly string[]): string[] {
  const allowed = new Set(pages);
  return areas
    .flatMap((area) => (existsSync(join(root, area)) ? walk(join(root, area)) : []))
    .filter((path) => path.endsWith(".ts") && !path.endsWith(".spec.ts"))
    .map((path) => relative(root, path))
    .sort()
    .filter((file) => !allowed.has(file))
    .flatMap((file) => {
      const source = parse(join(root, file));
      return nodes(source)
        .filter(ts.isClassDeclaration)
        .filter((c) => decorators(c).includes("Component"))
        .flatMap((c) =>
          nodes(c)
            .filter(ts.isCallExpression)
            .flatMap((call) => {
              const name = injected(call);
              return name !== undefined && isStoreOrApi(name)
                ? [`${file}:${lineOf(source, call)}: ${c.name?.text ?? "(anonymous)"} injects ${name}`]
                : [];
            }),
        );
    });
}

describe("store: the signal stores of board, library, spec and planning keep off templates and the DOM (ISC-436)", () => {
  test("store fixture: a clean store passes", () => {
    expect(storeViolations(join(FIXTURES, "store"), ["clean.store.ts"])).toEqual([]);
  });

  test("store fixture: DOCUMENT, ElementRef and the window global are each reported, prose is not", () => {
    expect(storeViolations(join(FIXTURES, "store"), ["dom.store.ts"])).toEqual([
      "dom.store.ts:1: imports DOCUMENT from @angular/common",
      "dom.store.ts:2: imports ElementRef from @angular/core",
      "dom.store.ts:17: uses the window global",
    ]);
  });

  test("store fixture: a missing file and an injectable not named *Store are reported", () => {
    expect(storeViolations(join(FIXTURES, "store"), ["missing.store.ts", "unnamed.store.ts"])).toEqual([
      "missing.store.ts: missing",
      "unnamed.store.ts: no @Injectable class named *Store",
    ]);
  });

  test("store app: every listed store exists and is clean", () => {
    expect(storeViolations(FEATURES, STORES)).toEqual([]);
  });
});

describe("pages: only page components of board, library, spec and planning inject state holders or ApiClient (ISC-437)", () => {
  const PAGE_FIXTURE = join(FIXTURES, "pages");

  test("pages fixture: a part component injecting a holder and one injecting ApiClient are reported, the page is not", () => {
    expect(pageViolations(PAGE_FIXTURE, ["board"], ["board/foo-page.ts"])).toEqual([
      "board/bar-list.ts:14: BarList injects ApiClient",
      "board/foo-card.ts:13: FooCard injects FooStore",
    ]);
  });

  test("pages fixture: listed, the same components pass", () => {
    expect(pageViolations(PAGE_FIXTURE, ["board"], ["board/foo-page.ts", "board/bar-list.ts", "board/foo-card.ts"])).toEqual([]);
  });

  test("pages app: every listed page exists", () => {
    expect(PAGES.filter((file) => !existsSync(join(FEATURES, file)))).toEqual([]);
  });

  test("pages app: no part component injects a holder or ApiClient", () => {
    expect(pageViolations(FEATURES, AREAS, PAGES)).toEqual([]);
  });
});
