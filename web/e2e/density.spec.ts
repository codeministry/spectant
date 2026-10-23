/**
 * Spec 021 (density and readability): one picture per view, the rest behind a disclosure whose open state is in the
 * address. Each claim is one `test.describe` group below; its titles carry the group's word, so `-g density.*<word>`
 * runs that group alone.
 *
 * - dashboard (T49 · ISC-246, `bun run e2e -- density -g dashboard`): against the dense stub (`DENSE_HEADER: on`, harbor
 *   with 22 specs and a fresh, sectioned TL;DR) the dashboard's TL;DR card shows its first section and folds the rest;
 *   the spec list, on the Specs page `/w/<ws>/specs` since spec 058 (the dashboard holds none), shows its head with the
 *   counters and its first `SPEC_ROW_CAP` rows; "show all N" opens the rest, writes `open=specs` into the address, a
 *   reload keeps it open, and closing it removes the key.
 * - names (T51 · ISC-248, `bun run e2e -- density -g names`): against the dense stub, whose long goal gives the spec
 *   head of `STUB_DENSE.goalSpec` a "More…" through overflow, the dashboard, the Specs page and that spec page at 1440,
 *   600 and 390 px carry no two visible interactive targets with the same accessible name, and every "More…" / "Less" /
 *   "Show all" / "Show whole" toggle names its object beyond its word. Since spec 068 (T12, ISC-545) Next up's entries
 *   are rows of the spec list: each title is cut by an ellipsis with no "More…", the reason is the row link's hidden
 *   description, not a line of its own, and every entry shows without a "Show all N".
 *   The names are Chromium's own (the CDP accessibility tree), not a re-implementation of the name computation.
 *
 * Expected texts come from the stub's own fixture (`STUB_DENSE`), never from a literal copy of it.
 */
import type { Locator, Page } from '@playwright/test';
import { atWidth, expect, test } from './fixtures';
import { DENSE_HEADER, STUB_DENSE } from './stub-api';

/** The rows the spec list shows before "show all N" (`SPEC_ROW_CAP`, `spec-table.ts`). */
const ROW_CAP = 10;
/** The dashboard widths of ISC-246: desktop, the side panel and the phone. */
const WIDTHS = [1440, 600, 390] as const;

/** The text of one `<!-- section: id -->` of the stub's TL;DR, its lines joined as the rendered paragraph joins them. */
function tldrSection(id: string): string {
  const match = new RegExp(`<!-- section: ${id} -->\\n([\\s\\S]*?)(?:\\n\\n|$)`, 'u').exec(STUB_DENSE.tldr);
  if (!match?.[1]) throw new Error(`STUB_DENSE.tldr has no section ${id}`);
  return match[1].replace(/\s+/gu, ' ').trim();
}

/** The first sentence of a section's text. */
function firstSentence(text: string): string {
  const sentence = text.split(/(?<=\.)\s/u)[0];
  if (!sentence) throw new Error('empty TL;DR section');
  return sentence;
}

const FIRST = firstSentence(tldrSection('overview'));
/** A sentence of a later section: folded until "show whole TL;DR" opens. */
const LATER = firstSentence(tldrSection('risks'));

/** The `open` keys in the page's address, in order. */
function openKeys(page: Page): string[] {
  const value = new URL(page.url()).searchParams.get('open');
  return value === null || value === '' ? [] : value.split(',');
}

/** Open the dense harbor dashboard and wait until its TL;DR card rendered. */
async function openDenseDashboard(page: Page): Promise<void> {
  await page.context().setExtraHTTPHeaders({ [DENSE_HEADER]: 'on' });
  await page.goto(`/w/${STUB_DENSE.workspace.slug}`);
  await expect(page.locator('[data-ui="brief"]')).toBeVisible();
}

/** Open the dense harbor Specs page (spec 058: the spec list's own page) and wait until its spec list rendered. */
async function openDenseSpecs(page: Page): Promise<void> {
  await page.context().setExtraHTTPHeaders({ [DENSE_HEADER]: 'on' });
  await page.goto(`/w/${STUB_DENSE.workspace.slug}/specs`);
  await expect(specRows(page).first()).toBeVisible();
}

const specTable = (page: Page): Locator => page.locator('app-spec-table');
const specRows = (page: Page): Locator => specTable(page).locator('[data-spec-row]');
const showAll = (page: Page): Locator => specTable(page).locator('[data-fold="specs"] button.summary');

for (const width of WIDTHS) {
  test.describe(`density dashboard at ${width}`, () => {
    test.use(atWidth(width));

    test(`density dashboard folds the TL;DR to its first section at ${width}`, async ({ page }) => {
      await openDenseDashboard(page);
      const card = page.locator('[data-ui="brief"]');
      await expect(card).toBeVisible();
      // Spec 058: the dashboard carries no spec list.
      await expect(specTable(page)).toHaveCount(0);

      const first = card.locator('[data-brief-first]');
      await expect(first).toBeVisible();
      await expect(first).toContainText(FIRST);
      await expect(first).not.toContainText(LATER);

      const fold = card.locator('[data-brief-fold]');
      await expect(fold).toHaveCount(1);
      await expect(fold.locator('button.summary')).toHaveAttribute('aria-expanded', 'false');
      await expect(card.locator('[data-brief-rest]')).toBeHidden();
      await expect(card.getByText(LATER)).toBeHidden();
      expect(openKeys(page)).not.toContain('tldr');
    });

    test(`density dashboard: the Specs page's spec list shows its head and ${ROW_CAP} rows at ${width}`, async ({ page }) => {
      await openDenseSpecs(page);
      const table = specTable(page);
      await expect(table.locator('#specs')).toBeVisible();
      const counts = table.locator('[data-counts]');
      await expect(counts).toBeVisible();
      await expect(counts.locator('[data-count="active"]')).toHaveText(`${STUB_DENSE.specs} specs`);
      await expect(counts.locator('[data-count="archived"]')).toBeVisible();

      await expect(specRows(page)).toHaveCount(ROW_CAP);
      for (const row of await specRows(page).all()) await expect(row).toBeVisible();

      const toggle = showAll(page);
      await expect(toggle).toBeVisible();
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await expect(toggle).toHaveText(`Show all ${STUB_DENSE.specs} specs`);
      expect(openKeys(page)).not.toContain('specs');
    });

    test(`density dashboard: the Specs page's show all opens, a reload keeps it, closing removes the key at ${width}`, async ({ page }) => {
      await openDenseSpecs(page);
      const toggle = showAll(page);
      await expect(specRows(page)).toHaveCount(ROW_CAP);

      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      await expect(specRows(page)).toHaveCount(STUB_DENSE.specs);
      await expect(specRows(page).last()).toBeVisible();
      await expect.poll(() => openKeys(page)).toContain('specs');

      await page.reload();
      await expect(specRows(page).first()).toBeVisible();
      await expect(showAll(page)).toHaveAttribute('aria-expanded', 'true');
      await expect(specRows(page)).toHaveCount(STUB_DENSE.specs);
      expect(openKeys(page)).toContain('specs');

      await showAll(page).click();
      await expect(showAll(page)).toHaveAttribute('aria-expanded', 'false');
      await expect(specRows(page)).toHaveCount(ROW_CAP);
      await expect.poll(() => openKeys(page)).not.toContain('specs');
      expect(new URL(page.url()).searchParams.has('open')).toBe(false);
    });
  });
}

/**
 * The accessible roles a user can act on. `DisclosureTriangle` is Chromium's role for `<summary>`; `combobox` covers a
 * `<select>`. Options inside a closed list are not targets of the view, so `option` is left out.
 */
const TARGET_ROLES = new Set([
  'link',
  'button',
  'DisclosureTriangle',
  'checkbox',
  'radio',
  'switch',
  'textbox',
  'searchbox',
  'combobox',
  'listbox',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'tab',
  'slider',
  'spinbutton',
]);

/** A toggle's visible word: "More…", "Less", "Show all …", "Show whole …". Its name must name more than the word. */
const TOGGLE_WORD = /^(?:more…|less|show (?:all|whole))(?=\s|,|$)/iu;

/** A toggle's visible word; null for no toggle. */
function toggleWord(target: Target): string | null {
  return TOGGLE_WORD.exec(target.text)?.[0] ?? null;
}

/** One visible interactive target: Chromium's role and accessible name, and what it shows. */
interface Target {
  readonly role: string;
  readonly name: string;
  readonly text: string;
  /** The element's tag and `data-*` hooks, so a failure says which element it is. */
  readonly hook: string;
}

/** Runs on the element: in the layout, not `aria-hidden` or inert, and its visible text and hooks. */
const DESCRIBE = `function () {
  const el = this;
  const box = el.getBoundingClientRect();
  const visible = box.width > 0 && box.height > 0 && el.checkVisibility({ visibilityProperty: true })
    && el.closest('[aria-hidden="true"], [inert]') === null;
  const hooks = [...el.attributes].filter((a) => a.name.startsWith('data-') && !a.name.startsWith('data-ng')).map((a) => a.value === '' ? a.name : a.name + '=' + a.value);
  let owner = el.parentElement;
  while (owner !== null && !owner.tagName.startsWith('APP-')) owner = owner.parentElement;
  const where = owner === null ? '' : 'in ' + owner.tagName.toLowerCase();
  const href = el.getAttribute('href');
  return {
    visible,
    text: (el.innerText ?? el.textContent ?? '').replace(/\\s+/gu, ' ').trim(),
    href,
    hook: [el.tagName.toLowerCase(), ...hooks, href === null ? '' : 'href=' + href, where].filter(Boolean).join(' '),
  };
}`;

const squash = (text: string): string => text.replace(/\s+/gu, ' ').trim();

/**
 * Every visible interactive target of the whole document (not only the viewport) with the accessible name Chromium
 * computed for it: the CDP accessibility tree drops `aria-hidden`, `display: none` and inert subtrees as ignored, and
 * each remaining node is checked for a layout box on its element.
 */
async function visibleTargets(page: Page): Promise<Target[]> {
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send('DOM.enable');
    await cdp.send('Accessibility.enable');
    const { nodes } = await cdp.send('Accessibility.getFullAXTree');
    const targets: Target[] = [];
    for (const node of nodes) {
      const role = String(node.role?.value ?? '');
      if (node.ignored || node.backendDOMNodeId === undefined || !TARGET_ROLES.has(role)) continue;
      const { object } = await cdp.send('DOM.resolveNode', { backendNodeId: node.backendDOMNodeId });
      if (object.objectId === undefined) continue;
      const { result } = await cdp.send('Runtime.callFunctionOn', { objectId: object.objectId, functionDeclaration: DESCRIBE, returnByValue: true });
      const info = result.value as { visible: boolean; text: string; hook: string };
      if (!info.visible) continue;
      targets.push({ role, name: squash(String(node.name?.value ?? '')), text: info.text, hook: info.hook });
    }
    return targets;
  } finally {
    await cdp.detach();
  }
}

/**
 * Targets outside ISC-248, left out of the duplicate check (never a toggle, which ISC-248 names). Each entry is a
 * repeated name another spec owns:
 * - copy chips: the same command (`Copy /spec implement 002`) offered in each place it applies (Next up, the spec row's
 *   guide, Waits on you, the warnings panel, the spec head, the rail guide); one action with one result wherever it is
 *   pressed (specs 020 and 025).
 * - the warnings panel's spec-id links (`004`): each warning and overlap names the spec it concerns by its id and leads
 *   to the same selection (`?sel=spec:<id>`) as every other link of that id in the panel.
 */
const OUT_OF_SCOPE: ReadonlyArray<(target: Target) => boolean> = [
  (t) => t.role === 'button' && t.name.startsWith('Copy /'),
  (t) => t.role === 'link' && /^\d{3}$/u.test(t.name) && t.hook.endsWith(' in app-warnings-panel'),
];

/** The names two or more visible targets share, with the targets that share each (case and spacing folded). */
function duplicates(targets: readonly Target[]): Record<string, string[]> {
  const byName = new Map<string, Target[]>();
  for (const target of targets) {
    if (target.name === '') continue;
    if (toggleWord(target) === null && OUT_OF_SCOPE.some((excluded) => excluded(target))) continue;
    const key = target.name.toLowerCase();
    byName.set(key, [...(byName.get(key) ?? []), target]);
  }
  const shared: Record<string, string[]> = {};
  for (const [name, list] of byName) if (list.length > 1) shared[name] = list.map((t) => `${t.role} ${t.hook}`);
  return shared;
}

/** Scroll every scroller to its end and back, so content deferred to the viewport is in the tree. */
async function scrollThrough(page: Page): Promise<void> {
  await page.evaluate(() => {
    const scrollers = [document.scrollingElement, ...document.querySelectorAll('*')].filter(
      (el): el is Element => el !== null && el.scrollHeight > el.clientHeight + 1,
    );
    for (const el of scrollers) el.scrollTop = el.scrollHeight;
    for (const el of scrollers) el.scrollTop = 0;
  });
}

/**
 * The overflow toggles of the view: the goal in the spec head. A spec row has none, and since spec 068 Next up's
 * entries are spec rows, so the dashboard has none either.
 */
const overflowToggles = (page: Page): Locator => page.locator('app-spec-head [data-more]');

/** Wait until the clamp measured: the view's overflow toggles are there and their count holds still. */
async function togglesSettled(page: Page, ready: Locator): Promise<void> {
  await expect(ready.first()).toBeVisible();
  await scrollThrough(page);
  let last = -1;
  await expect
    .poll(async () => {
      const count = await overflowToggles(page).count();
      const settled = count === last;
      last = count;
      return settled;
    })
    .toBe(true);
}

const NAME_VIEWS = [
  {
    view: 'dashboard',
    path: `/w/${STUB_DENSE.workspace.slug}`,
    // Spec 068 (T12, ISC-545): the last Next-up entry's row link. Every entry is a spec row shown directly, with no
    // "Show all N" fold, so the last one stands visible once Next up rendered.
    ready: (page: Page): Locator => page.locator('[data-next-card] app-spec-row[data-next-row] a[data-next-link]').nth(STUB_DENSE.next - 1),
  },
  {
    view: 'specs page',
    path: `/w/${STUB_DENSE.workspace.slug}/specs`,
    // The list's "Show all N" fold stands once its rows rendered; the rows have no "More…" (their titles end in "…").
    ready: (page: Page): Locator => page.locator('app-spec-table [data-fold="specs"] button.summary'),
  },
  {
    view: 'spec page',
    path: `/w/${STUB_DENSE.workspace.slug}/s/${STUB_DENSE.goalSpec}`,
    ready: (page: Page): Locator => page.locator('app-spec-head [data-more]'),
  },
] as const;

for (const width of WIDTHS) {
  test.describe(`density names at ${width}`, () => {
    test.use(atWidth(width));

    for (const { view, path, ready } of NAME_VIEWS) {
      test(`density names: no two visible targets of the ${view} share a name at ${width}`, async ({ page }) => {
        await page.context().setExtraHTTPHeaders({ [DENSE_HEADER]: 'on' });
        await page.goto(path);
        await togglesSettled(page, ready(page));

        const targets = await visibleTargets(page);
        expect(targets.length).toBeGreaterThan(0);
        expect(duplicates(targets), `targets of the ${view} at ${width} sharing a name`).toEqual({});
      });

      test(`density names: every toggle of the ${view} names its object at ${width}`, async ({ page }) => {
        await page.context().setExtraHTTPHeaders({ [DENSE_HEADER]: 'on' });
        await page.goto(path);
        await togglesSettled(page, ready(page));

        const toggles = (await visibleTargets(page)).filter((t) => toggleWord(t) !== null);
        // Every overflow toggle of the view counts, plus its "Show all" / "Show whole" folds.
        expect(toggles.length).toBeGreaterThanOrEqual(await overflowToggles(page).count());
        const unnamed = toggles
          .filter((t) => {
            const word = toggleWord(t) ?? t.text;
            const object = squash(t.name.slice(word.length).replace(/^[\s,]+/u, ''));
            // Label in name (WCAG 2.5.3): the name starts with the toggle's visible word and names an object after it.
            return !t.name.toLowerCase().startsWith(word.toLowerCase()) || object === '';
          })
          .map((t) => `${t.hook}: "${t.text}" named "${t.name}"`);
        expect(unnamed, `toggles of the ${view} at ${width} named only by their word`).toEqual([]);
      });
    }
  });
}
