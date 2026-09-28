// @ts-check
// Static tier, part one (ISC-5.2): `bun run lint` = `eslint . --max-warnings 0`.
// Flat config for the whole workspace. Bun code (core/, server/, scripts/, tests/, web/tests/) is typed through the
// root tsconfig.json; the Angular app (web/src/) through web/tsconfig.app.json and web/tsconfig.spec.json.
import eslint from '@eslint/js';
import angular from 'angular-eslint';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
  {
    // Build output, caches and generated fixture trees are not source.
    ignores: ['**/dist/**', '**/coverage/**', 'web/.angular/**', 'web/public/**', 'specs/**', '**/.vendor/**', '**/*.gen.ts', '.claude/**'],
  },

  // Plain JavaScript (this file and any config next to it): the core recommended set, no type information.
  {
    files: ['**/*.js', '**/*.mjs'],
    extends: [eslint.configs.recommended],
  },

  // Every TypeScript file in the workspace: strict + stylistic, type-aware.
  {
    files: ['**/*.ts'],
    extends: [
      eslint.configs.recommended,
      tseslint.configs.strictTypeChecked,
      tseslint.configs.stylisticTypeChecked,
    ],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Numbers in template literals are the normal way to build messages, IDs and paths in the CLI and scripts.
      // Every other `allow*` is spelled out as false: an options object merges over the rule's lax defaults, not over
      // the strict preset, so `{ allowNumber: true }` alone would also let `undefined` and `any` through.
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        {
          allowNumber: true,
          allowAny: false,
          allowArray: false,
          allowBoolean: false,
          allowNever: false,
          allowNullish: false,
          allowRegExp: false,
        },
      ],
      // `T[]` for simple element types, `Array<…>` for inline object and union types, where `{…}[]` reads badly.
      '@typescript-eslint/array-type': ['error', { default: 'array-simple' }],
      // The stylistic preset would rewrite `x as T` into `x!`, which the strict preset then forbids; the house
      // wants narrowing (`?? throw`, a `must()` helper), so the style rule is off and `no-non-null-assertion` stays.
      '@typescript-eslint/non-nullable-type-assertion-style': 'off',
      // Both are in use for plain data shapes (`type` in server/ and scripts/, `interface` in core/); either is fine.
      '@typescript-eslint/consistent-type-definitions': 'off',
      // `.catch((e) => console.error(e))` and `.forEach((x) => set.add(x))` are clear; braces would add noise only.
      '@typescript-eslint/no-confusing-void-expression': ['error', { ignoreArrowShorthand: true }],
      // Angular components, directives and pipes are decorated classes that may legitimately have an empty body.
      '@typescript-eslint/no-extraneous-class': ['error', { allowWithDecorator: true }],
    },
  },

  // Angular component and service code.
  {
    files: ['web/src/**/*.ts'],
    extends: [angular.configs.tsRecommended],
    processor: angular.processInlineTemplates,
    rules: {
      '@angular-eslint/component-selector': ['error', { type: 'element', prefix: ['app', 'ui'], style: 'kebab-case' }], // ui-* are the shared primitives (design.md § Components)
      '@angular-eslint/directive-selector': ['error', { type: 'attribute', prefix: ['app', 'ui'], style: 'camelCase' }],
      // Standalone only: an NgModule brings back a second way to declare and import (FE-FW, web/CLAUDE.md).
      '@angular-eslint/prefer-standalone': 'error',
      // OnPush everywhere: zoneless rendering is driven by signals and marked views, never by a global sweep.
      '@angular-eslint/prefer-on-push-component-change-detection': 'error',
      // Bans `@Input()` and the query decorators (`@ViewChild()` …): `input()` / `viewChild()` keep one reactive
      // model the compiler can check; a decorator input is invisible to `computed()` and needs ngOnChanges.
      '@angular-eslint/prefer-signals': 'error',
      // Bans `@Output()`: `output()` needs no EventEmitter (an RxJS Subject) in component code.
      '@angular-eslint/prefer-output-emitter-ref': 'error',
      '@angular-eslint/prefer-inject': 'error',
    },
  },

  {
    // The CLI-generated bootstrap logs its error with an implicitly `any` callback parameter. Owned by the web lane,
    // which can type it `(err: unknown)` and drop this block.
    files: ['web/src/main.ts'],
    rules: { '@typescript-eslint/use-unknown-in-catch-callback-variable': 'off' },
  },

  // Angular templates, inline (extracted by the processor above) and external.
  {
    files: ['web/src/**/*.html'],
    extends: [angular.configs.templateRecommended, angular.configs.templateAccessibility],
    rules: {
      // Bans `*ngIf`, `*ngFor` and `[ngSwitch]`: `@if` / `@for` / `@switch` need no import, type-narrow, and keep
      // one idiom per concern.
      '@angular-eslint/template/prefer-control-flow': 'error',
      '@angular-eslint/template/prefer-self-closing-tags': 'error',
      'no-restricted-syntax': [
        'error',
        {
          // Bans `| async`: components read signals (RxJS is bridged with `toSignal` at the I/O boundary). A stream
          // in a template brings back hidden subscriptions and a second change-detection trigger.
          selector: 'BindingPipe[name="async"]',
          message: 'The async pipe is banned: bridge the observable with toSignal() and read the signal.',
        },
      ],
    },
  },
);
