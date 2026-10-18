/**
 * Spec 020 (next-step guidance), the anti-claim against the stub API (T31, ISC-243):
 * `bun run --cwd web e2e -- -g "guidance anti"`.
 *
 * On the four surfaces — the start `/`, the workspace dashboard (`#waiting`, Next up, the Specs table's guide rows), the
 * workspace board and the spec page (its rail, the dashboard tab's spot, the compact guide card) — every guidance entry
 * the UI shows is collected with its spec, its reference, its sentence and its place, and compared with the API body
 * the page renders: the dashboard's `guidance` per workspace, the spec page's own slice. Zero entries the API does not
 * deliver, zero sentences other than the catalogue sentence of the API's reason (`guidance-sentence.ts`), and the order
 * exactly the API's (`waits` on the start and in `#waiting`, `next` in Next up). Each surface runs under the default
 * stub and under `X-Spectant-Stub-Waits: 1` and `7`. The repository half of ISC-243 (loading the guidance and copying a
 * command change no byte, `.git/` included) is `bun run test:readonly -- -t guidance`.
 */
import type { APIRequestContext, Locator, Page } from '@playwright/test';
import { atWidth, expect, test, WIDTHS } from './fixtures';
import { type GuidanceEntryView, type GuidanceView, sentenceOf, specEntryOf } from './guidance-sentence';
import { WAITS_HEADER } from './stub-api';

/** A guidance entry as the API serves it (structural; `GuidanceEntryView` plus the fields compared here). */
type Entry = GuidanceEntryView & { readonly ref: string | null; readonly command: string | null };
type Guidance = { readonly waits: readonly Entry[]; readonly next: readonly Entry[] };
type WorkspaceRow = { readonly slug: string; readonly readable: boolean };
type DashboardBody = { readonly specs: ReadonlyArray<{ readonly id: string }>; readonly guidance?: Guidance };
type SpecBody = { readonly head: { readonly id: string }; readonly next: { readonly reasons: readonly string[] }; readonly guidance?: GuidanceView };

/** What a surface lists for one entry: the label it names it by and its sentence, whitespace collapsed. */
type Shown = { readonly label: string; readonly sentence: string };

const VARIANTS = [null, '1', '7'] as const;
type Variant = (typeof VARIANTS)[number];

const text = (s: string | null | undefined): string => (s ?? '').replace(/\s+/gu, ' ').trim();
const headersOf = (variant: Variant): Record<string, string> => (variant === null ? {} : { [WAITS_HEADER]: variant });
const labelOf = (variant: Variant): string => (variant === null ? 'default stub' : `${WAITS_HEADER}: ${variant}`);

/** How an entry reads in a workspace-scoped list (spec number) or a spec-scoped one (its own reference). */
const shownOf = (entry: Entry, scope: 'workspace' | 'spec'): Shown => ({
  label: scope === 'spec' && entry.ref !== null ? entry.ref : entry.spec,
  sentence: text(sentenceOf(entry.reason)),
});

// ---- API bodies -----------------------------------------------------------------------------------------------------

async function getJson<T>(request: APIRequestContext, path: string, headers: Record<string, string>): Promise<T> {
  const answer = await request.get(path, { headers });
  expect(answer.status(), `GET ${path}`).toBe(200);
  return (await answer.json()) as T;
}

async function workspacesOf(request: APIRequestContext, headers: Record<string, string>): Promise<string[]> {
  const rows = await getJson<WorkspaceRow[]>(request, '/api/workspaces', headers);
  const slugs = rows.filter((w) => w.readable).map((w) => w.slug);
  expect(slugs.length, 'the stub lists readable workspaces').toBeGreaterThan(0);
  return slugs;
}

async function dashboardOf(request: APIRequestContext, ws: string, headers: Record<string, string>): Promise<{ body: DashboardBody; guidance: Guidance }> {
  const body = await getJson<DashboardBody>(request, `/api/workspaces/${encodeURIComponent(ws)}/dashboard`, headers);
  expect(body.guidance, `${ws}: the dashboard carries guidance`).toBeDefined();
  return { body, guidance: body.guidance ?? { waits: [], next: [] } };
}

/** The spec's own entry (`item: 'spec'`), the one every surface reads its sentence from. */
const ownOf = (guidance: Guidance, spec: string): Entry | undefined => specEntryOf(guidance, spec) as Entry | undefined;

/** The specs whose own entry stands in `waits`, sorted. */
const waitingSpecs = (guidance: Guidance): string[] => [...new Set(guidance.waits.filter((e) => e.item === 'spec').map((e) => e.spec))].sort();

// ---- DOM readers ----------------------------------------------------------------------------------------------------

/** Every entry a `ui-waits-block` lists, the highlighted one first, then its rows, in DOM order. */
async function blockEntries(block: Locator): Promise<Shown[]> {
  return block.evaluate((el) =>
    [...el.querySelectorAll('[data-top], [data-row]')].map((row) => ({
      label: (row.querySelector('.id')?.textContent ?? '').replace(/\s+/gu, ' ').trim(),
      sentence: (row.querySelector('[data-reason]')?.textContent ?? '').replace(/\s+/gu, ' ').trim(),
    })),
  );
}

/** Every `ui-waits-block` on the page, each as its listed entries. */
async function allBlocks(page: Page): Promise<Shown[][]> {
  const blocks = await page.locator('ui-waits-block').all();
  const out: Shown[][] = [];
  for (const block of blocks) out.push(await blockEntries(block));
  return out;
}

// ---- the anti-test --------------------------------------------------------------------------------------------------

test.describe('guidance anti', () => {
  test.use(atWidth(WIDTHS.desktop));

  for (const variant of VARIANTS) {
    const headers = headersOf(variant);
    const label = labelOf(variant);

    test(`anti: ${label} — the start shows only the API's waiting entries, in its order`, async ({ page, request }) => {
      await page.context().setExtraHTTPHeaders(headers);
      const slugs = await workspacesOf(request, headers);
      const expected = new Map<string, Shown[]>();
      for (const ws of slugs) expected.set(ws, (await dashboardOf(request, ws, headers)).guidance.waits.map((e) => shownOf(e, 'workspace')));

      await page.goto('/');
      await expect(page.locator('[data-ui="workspace-column"]').first()).toBeVisible();
      // No guidance block stands outside a workspace column, and no column lacks one.
      await expect(page.locator('ui-waits-block'), 'one block per workspace, none elsewhere').toHaveCount(slugs.length);
      await expect(page.locator('[data-ui="workspace-column"] ui-waits-block')).toHaveCount(slugs.length);
      // Next up stays off the start: no Next entry the start could show.
      await expect(page.locator('[data-next-up], app-next-up-entry, app-spec-row-guide')).toHaveCount(0);

      for (const ws of slugs) {
        const want = expected.get(ws) ?? [];
        const block = page.locator(`[data-ui="workspace-column"][data-ws="${ws}"] ui-waits-block`);
        await expect(block, `${ws}: the column's block`).toBeVisible();
        await expect(block).toHaveAttribute('data-count', String(want.length));
        // The top entry and at most four rows: exactly the API's first entries, in its order, each with its sentence.
        expect(await blockEntries(block), `${ws}: the start lists the API's waits, in order`).toEqual(want.slice(0, 5));
      }
    });

    test(`anti: ${label} — the workspace dashboard's #waiting, Next up and guide rows only from the API`, async ({ page, request }) => {
      await page.context().setExtraHTTPHeaders(headers);
      for (const ws of await workspacesOf(request, headers)) {
        const { body, guidance } = await dashboardOf(request, ws, headers);
        // Spec 021: the spec list folds behind its first five rows; `?open=specs` opens it so every guide row renders.
        await page.goto(`/w/${ws}?open=specs#waiting`);
        const section = page.locator('#waiting');
        await expect(section, `${ws}: the #waiting section`).toBeVisible();

        // #waiting: open "Show all n", then the block and the folded rows list the API's waits exactly, in order.
        const fold = section.locator('[data-show-all] button').first();
        if ((await fold.count()) > 0 && (await fold.getAttribute('aria-expanded')) !== 'true') await fold.click();
        const listed = await section.evaluate((el) =>
          [...el.querySelectorAll('[data-top], [data-row]')].map((row) => ({
            label: (row.querySelector('.id')?.textContent ?? '').replace(/\s+/gu, ' ').trim(),
            sentence: (row.querySelector('[data-reason]')?.textContent ?? '').replace(/\s+/gu, ' ').trim(),
          })),
        );
        expect(listed, `${ws}: #waiting lists the API's waits, in order`).toEqual(guidance.waits.map((e) => shownOf(e, 'workspace')));
        await expect(page.locator('ui-waits-block'), `${ws}: no waits block outside #waiting`).toHaveCount(await section.locator('ui-waits-block').count());

        // Next up: guidance.next in its order, one entry per listed spec, each with its sentence, never a marker.
        const ids = new Set(body.specs.map((s) => s.id));
        const seen = new Set<string>();
        const next = guidance.next.filter((e) => ids.has(e.spec) && !seen.has(e.spec) && (seen.add(e.spec), true));
        if (next.length > 0) await expect(page.locator('app-next-up-entry').first(), `${ws}: Next up renders`).toBeVisible();
        const nextFold = page.locator('app-next-up-list [data-show-all] button').first();
        if ((await nextFold.count()) > 0 && (await nextFold.getAttribute('aria-expanded')) !== 'true') await nextFold.click();
        const shownNext = await page.locator('app-next-up-entry').evaluateAll((els) =>
          els.map((el) => ({
            label: el.getAttribute('data-next-entry') ?? '',
            sentence: (el.querySelector('[data-next-guide] [data-next-sentence]')?.textContent ?? '').replace(/\s+/gu, ' ').trim(),
            marked: el.querySelector('[data-waits-mark], [data-card-marker]') !== null,
          })),
        );
        expect(shownNext, `${ws}: Next up lists the API's next, in order`).toEqual(next.map((e) => ({ ...shownOf(e, 'workspace'), marked: false })));

        // Specs table: a guide row exactly for each spec with its own entry, its sentence and kind the API's.
        await expect(page.locator('app-spec-row-guide').first(), `${ws}: the guide rows render`).toBeVisible();
        const rows = await page.locator('app-spec-row-guide').evaluateAll((els) =>
          els.map((el) => ({
            spec: el.getAttribute('data-reason') ?? '',
            guide: el.getAttribute('data-guide'),
            marked: el.querySelector('[data-waits-mark]') !== null,
            sentence: (el.querySelector('[data-guide-sentence]')?.textContent ?? '').replace(/\s+/gu, ' ').trim(),
          })),
        );
        const waiting = new Set(waitingSpecs(guidance));
        const wantRows = body.specs.flatMap(({ id }) => {
          const own = ownOf(guidance, id);
          return own ? [{ spec: id, guide: waiting.has(id) ? 'waits' : 'next', marked: waiting.has(id), sentence: text(sentenceOf(own.reason)) }] : [];
        });
        expect([...rows].sort((a, b) => a.spec.localeCompare(b.spec)), `${ws}: the guide rows are the API's own entries`).toEqual(
          [...wantRows].sort((a, b) => a.spec.localeCompare(b.spec)),
        );
        // No "Waits on you" mark anywhere on the page beyond the waiting specs' rows.
        await expect(page.locator('main [data-waits-mark], main [data-card-marker]'), `${ws}: marks on the page`).toHaveCount(waiting.size);
      }
    });

    test(`anti: ${label} — the workspace board marks and reads only what the API delivers`, async ({ page, request }) => {
      await page.context().setExtraHTTPHeaders(headers);
      for (const ws of await workspacesOf(request, headers)) {
        const { body, guidance } = await dashboardOf(request, ws, headers);
        await page.goto(`/w/${ws}/board`);
        await expect(page.locator('app-board-page app-board-card').first()).toBeVisible();
        const cards = await page.locator('app-board-card').evaluateAll((els) =>
          els.map((el) => ({
            key: el.getAttribute('data-key') ?? '',
            id: el.querySelector('.r1 .num')?.textContent.trim() ?? '',
            marked: el.querySelector('[data-card-marker]') !== null,
            reason: (el.querySelector('[data-card-state] [data-reason-shown]')?.textContent ?? '').replace(/\s+/gu, ' ').trim(),
          })),
        );
        const waiting = waitingSpecs(guidance);
        expect(cards.filter((c) => c.marked).map((c) => c.id).sort(), `${ws}: the marked cards are the API's waiting specs`).toEqual(waiting);
        expect(cards.filter((c) => c.marked && !c.key.startsWith('spec:')), `${ws}: no story carries the marker`).toEqual([]);
        for (const { id } of body.specs) {
          const own = ownOf(guidance, id);
          if (own === undefined) continue;
          const card = cards.find((c) => c.key.startsWith('spec:') && c.id === id);
          expect(card?.reason, `${ws} ${id}: the card reads the API's sentence`).toBe(text(sentenceOf(own.reason)));
        }
      }
    });

    test(`anti: ${label} — the spec page's rail, spot and guide card show only the API slice`, async ({ page, request }) => {
      test.setTimeout(180_000);
      await page.context().setExtraHTTPHeaders(headers);
      for (const ws of await workspacesOf(request, headers)) {
        const { body: dashboard, guidance: wide } = await dashboardOf(request, ws, headers);
        // Every spec the guidance names, and the first one it does not.
        const named = new Set([...wide.waits, ...wide.next].map((e) => e.spec));
        const unnamed = dashboard.specs.find((s) => !named.has(s.id));
        const specs = [...dashboard.specs.filter((s) => named.has(s.id)), ...(unnamed ? [unnamed] : [])].map((s) => s.id);

        for (const id of specs) {
          const body = await getJson<SpecBody>(request, `/api/workspaces/${encodeURIComponent(ws)}/specs/${id}`, headers);
          expect(body.guidance, `${ws} ${id}: the spec page carries guidance`).toBeDefined();
          const slice = (body.guidance ?? { waits: [], next: [] }) as Guidance;
          // The slice is the workspace's guidance for this spec, entry for entry and in order.
          expect(slice, `${ws} ${id}: the slice is the dashboard's entries of this spec`).toEqual({
            waits: wide.waits.filter((e) => e.spec === id),
            next: wide.next.filter((e) => e.spec === id),
          });
          const own = ownOf(slice, id);
          const selfWaits = own !== undefined && slice.waits.includes(own);
          const others = slice.waits.filter((e) => e !== own).map((e) => shownOf(e, 'spec'));
          const sentence = own ? text(sentenceOf(own.reason)) : text(body.next.reasons[0]);

          for (const tab of ['', 'status', 'board'] as const) {
            const route = `/w/${ws}/s/${id}${tab ? `/${tab}` : ''}`;
            await page.goto(route);
            await expect(page.locator('app-shell')).toHaveAttribute('data-tier', 'wide');
            const spot =
              tab === ''
                ? page.locator('app-spec-dashboard [data-section="next"]')
                : tab === 'board'
                  ? page.locator('app-spec-guide [data-spec-guide]')
                  : page.locator('app-spec-rail [data-rail-block="next"]');
            await expect(spot, `${route}: the guidance spot`).toBeVisible();

            // Every sentence the page shows for the spec itself is its own entry's (else the model's next reason).
            if (tab === '' && own === undefined) await expect(spot.locator('[data-guidance-reason]'), `${route}: no own sentence`).toHaveCount(0);
            const sentences = await page.locator('[data-guidance-reason], [data-rail-reason], [data-guide-reason]').evaluateAll((els) =>
              els.map((el) => {
                const copy = el.cloneNode(true) as Element;
                for (const chip of copy.querySelectorAll('[data-guide-marker]')) chip.remove();
                return copy.textContent.replace(/\s+/gu, ' ').trim();
              }),
            );
            expect(sentences.length, `${route}: the spot carries the sentence`).toBeGreaterThan(0);
            for (const s of sentences) expect(s, `${route}: the spec's sentence`).toBe(sentence);

            // The marker stands only where the API's own entry waits on you.
            const markers = page.locator('[data-rail-marker], [data-waits-mark], [data-guide-marker], [data-card-marker]');
            if (selfWaits) expect(await markers.count(), `${route}: the marker of a waiting spec`).toBeGreaterThan(0);
            else await expect(markers, `${route}: no marker without a waiting own entry`).toHaveCount(0);

            // Every waits block lists the slice's other waiting entries, in order, from the first: never one more.
            for (const listed of await allBlocks(page)) {
              expect(listed, `${route}: a waits block lists the slice's waits, in order`).toEqual(others.slice(0, listed.length));
              expect(listed.length, `${route}: a waits block lists at least the first six`).toBeGreaterThanOrEqual(Math.min(others.length, 6));
            }
            if (others.length === 0) await expect(page.locator('ui-waits-block'), `${route}: no waits block`).toHaveCount(0);
            else if (tab !== 'board') expect((await allBlocks(page)).length, `${route}: the slice's waits stand in a block`).toBeGreaterThan(0);

            // The compact guide card names how many others wait, the slice's count.
            const more = page.locator('[data-guide-waiting]');
            if (others.length === 0) await expect(more).toHaveCount(0);
            else if (tab === 'board') await expect(more, `${route}: +n waiting`).toHaveCount(1);
            if (others.length > 0 && (await more.count()) > 0) expect(text(await more.textContent()), `${route}: +n waiting`).toContain(String(others.length));
          }
        }
      }
    });
  }
});
