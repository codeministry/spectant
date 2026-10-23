/**
 * The web lane's entry for `scripts/check-architecture.ts` (spec 060, ISC-423, ISC-424).
 *
 * The Angular app under `web/src/app`: components, their templates and their stylesheets, each at most 400 lines and
 * without a copied block of 50 tokens or more (jscpd `typescript`, `markup` and `css`), and the layers core ← shared ←
 * layout ← features (`layers`). The entry lives in a file of its own, so the fixture configurations of the tests load
 * it without the server entry; `scripts/architecture.config.ts` lists it, and `bun run check:static` runs it.
 */
import type { IsolationConfig, LaneEntry } from "../architecture.config.ts";
import { TEST_AND_GENERATED } from "./files.ts";

/**
 * The web entry's feature area for the `isolation` rule (spec 061, ISC-431): no folder under `features/` imports
 * another, statically, type-only or through a dynamic `import()`.
 */
export const webIsolation: IsolationConfig = { area: "features" };

export const web: LaneEntry = {
  name: "web",
  root: "web/src/app",
  extensions: [".ts", ".html", ".css"],
  // `dev/**` (the developer gallery) belongs to no layer and stays out of size and duplicates (spec 060 decision
  // 2026-10-21); every other file under web/src/app is checked (spec 061, ISC-430).
  ignore: [...TEST_AND_GENERATED, "dev/**"],
  isolation: webIsolation,
  size: { maxLines: 400 },
  duplicates: {
    minTokens: 50,
    allow: [
      {
        files: ["layout/assistant/assistant-panel.css", "layout/detail-sidebar/detail-sidebar.css"],
        why:
          "four surface declarations on two different selectors (.as-panel, .panel); " +
          "no shared rule without a DOM change (spec 060 decision 2026-10-21)",
      },
      {
        files: ["features/dashboard/dashboard-page.html", "features/dashboard/specs-page/specs-page.html"],
        why:
          "the two pages' root @if chain over the workspace state (missing, unavailable, ready); a shared component " +
          "would add a wrapper element around the page content, and the Specs page root takes none (spec 061)",
      },
      {
        files: ["features/dashboard/spec-table/idea-row.css", "features/dashboard/spec-table/_row-link.css"],
        why:
          "the one-line title link cut by an ellipsis on two different selectors (.link of the idea row, .row-link of " +
          "the spec row, styled by the list that projects it, the spec list's and Next up's since spec 068); no " +
          "shared rule without a common class, a DOM change",
      },
      {
        files: ["features/dashboard/spec-table/spec-row.css", "features/spec/status/timeline/timeline-tab.css"],
        why:
          "a muted 13/20 mono tabular date on two different selectors (.rdate, .time) in two features; no shared " +
          "rule without a common class, a DOM change (spec 061)",
      },
      {
        files: ["features/help/help-lifecycle.css", "features/help/workflow-figure.css"],
        why:
          "the dotted 16 px canvas grid on two different selectors (.flow-canvas, .canvas) with different frames; " +
          "no shared rule without a common class, a DOM change (spec 061)",
      },
      {
        files: ["features/help/help-page.html", "features/shortcuts/shortcut-sheet.html"],
        why:
          "one binding row (label and keys) in the Keyboard section and the ? sheet under different classes " +
          "(.key-row, .row); a shared row component would move the spans out of each owner's scoped styles (spec 061)",
      },
      {
        files: ["features/library/library-page.css", "features/settings/settings-workspaces-page.css"],
        why:
          "a 40 px search field frame on two different selectors (app-library-page .lib-search, the workspaces " +
          "path field) in different inks (--muted-ink, --muted); no shared rule without a DOM change (spec 061)",
      },
      {
        files: ["features/settings/settings-page.css", "layout/not-found/not-found.css"],
        why:
          "a bordered link row on two different selectors (.row-link 48 px flex, .d-row 44 px grid); no shared " +
          "rule without a common class, a DOM change; the .text-link both use is shared/ui/_text-link.css (spec 061)",
      },
      {
        files: ["features/library/library-page.css", "features/spec/data/claims/claims-tab.css"],
        why:
          "the bordered field surface (border, radius, base-100, muted ink) under different selectors with their own " +
          "geometry: the Library's unencapsulated .lib-search (40 px) and the Claims tab's emulated .search (36 px); " +
          "no shared rule without a DOM change (spec 061, T21)",
      },
      {
        files: ["features/library/library-page.css", "features/spec/live/board/_board-controls.css"],
        why:
          "the bordered field surface (border, radius, base-100, muted ink) under different selectors with their own " +
          "geometry: the Library's unencapsulated .lib-search and the Board tab's emulated .bsearch (32 px); no " +
          "shared rule without a DOM change (spec 061, T21)",
      },
      {
        files: ["features/library/library-page.css", "layout/shell/shell-live.css"],
        why:
          "the bordered field surface (border, radius, base-100, muted ink) under different selectors with their own " +
          "geometry: the Library's .lib-search and the live indicator's .group, a different control; no shared rule " +
          "without a DOM change (spec 061, T21)",
      },
      {
        files: ["features/spec/data/claims/claims-tab.css", "features/spec/live/board/_board-controls.css"],
        why:
          "the bordered field surface (border, radius, base-100, muted ink) under different selectors with their own " +
          "geometry: .search and .bsearch in two emulated components; no shared rule without a DOM change (spec 061, " +
          "T21)",
      },
      {
        files: ["features/spec/data/claims/claims-tab.css", "layout/shell/shell-live.css"],
        why:
          "the bordered field surface (border, radius, base-100, muted ink) under different selectors with their own " +
          "geometry: the Claims tab's .search and the live indicator's .group, a different control; no shared rule " +
          "without a DOM change (spec 061, T21)",
      },
      {
        files: ["features/library/library-page.css", "features/planning/planning-graph/planning-graph.css"],
        why:
          "the filter pill under two unencapsulated hosts and classes (.lib-pill 34 px with font: inherit, " +
          ".graph-pill 32 px); a shared rule would carry one feature's host into the other's sheet or into shared/ " +
          "(spec 061, T21)",
      },
      {
        files: ["features/library/library-reader.css", "layout/spec-head/spec-head.css"],
        why:
          "both reach into ui-disclosure's .summary for their own row height (.lib-section 36 px, .overlap-fold 32 " +
          "px) and the 44 px coarse floor; the primitive has no size input, so a shared rule needs a DOM change " +
          "(spec 061, T21)",
      },
      {
        files: ["features/spec/notes/notes-area-content.css", "shared/ui/doc-prose/doc-prose.css"],
        why:
          "the inline code look of two unencapsulated prose containers (.notes-preview code, .docs-prose code); a " +
          "shared rule would carry the notes feature's host into shared/ (spec 061, T21)",
      },
      {
        files: ["features/spec/_spec-card.css", "shared/ui/card/card.css"],
        why:
          "the card surface on ui-card's :host and on the spec pages' plain .section-card/.sr-card elements (no " +
          "ui-card: no clip, no isolation); no shared rule without a DOM change (spec 061, T21)",
      },
      {
        files: ["features/spec/_spec-context.css", "shared/ui/section-header/section-header.css"],
        why:
          "the uppercase eyebrow type on ui-section-header's .eyebrow and the spec context's .eyebrow/.block-head " +
          "h2/.sr-eyebrow in other components; a shared partial would carry the feature's class names into shared/ " +
          "(spec 061, T21)",
      },
      {
        files: ["features/spec/live/board/_board-controls.css", "layout/assistant/assistant-panel.css"],
        why:
          "the floating panel surface (padding, border, card radius, base-100, shadow) on the lane filter popover " +
          "(.lane-pop) and the assistant panel (.as-panel), two components; no shared rule without a DOM change " +
          "(spec 061, T21)",
      },
      {
        files: ["features/spec/live/board/board-tab.css", "features/spec/live/this-frame/your-steps.css"],
        why:
          "the lane box on the Board tab's .lane and your-steps' :host (8 px gap, base-100 against --lane); a :host " +
          "rule cannot be shared with a class rule (spec 061, T21)",
      },
      {
        files: ["features/spec/live/board/board-tab.css", "features/spec/live/card/card-detail.css"],
        why:
          "the hairline icon button in two emulated components with their own size (.btn-icon-sm 28 px, flex none; " +
          ".close 32 px with its hover ink); no shared rule without a DOM change (spec 061, T21)",
      },
      {
        files: ["features/spec/live/this-frame/frame-bar.css", "features/spec/live/this-frame/this-frame.css"],
        why:
          "the flat button reset on two different controls in two components (the bar's .main, 44 px flex row; the " +
          "frame event .fev, 24 px block, its own transition); no shared rule without a DOM change (spec 061, T21)",
      },
      {
        files: ["features/board/board-card.css", "shared/ui/id-chip/id-chip.css"],
        why:
          "the id type (mono 13/20, weight 600, --disp-ink) on two different selectors: the card's `.num` span and " +
          "ui-id-chip's `:host`; a shared `:host` rule would style the card's host, and putting ui-id-chip on the span " +
          "changes the DOM and adds the chip's inline-block and nowrap (spec 061, T21)",
      },
      {
        files: ["features/board/move-to-menu.html", "layout/backlog-menu/reorder-menu.html"],
        why:
          "the compact `ui-sheet` / `ui-popover` switch around each menu's own `#list` template; an ng-template " +
          "cannot cross components, and a shared surface component would add a host element around both panels " +
          "(a DOM change) (spec 061, T21)",
      },
    ],
  },
  layers: { order: ["core", "shared", "layout", "features"] },
};
