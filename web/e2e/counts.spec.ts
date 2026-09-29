/**
 * T61 · ISC-72: every counter on the spec dashboard and on its tabs equals the parser's golden JSON for the same
 * fixture. `bun run e2e -- counts` is the probe (0 mismatches). The suite is one table: each row names the route, what
 * it counts, the golden field it must equal and the selector that reads it, and becomes its own test
 * "<route> <what>", so a mismatch names exactly the counter that drifted. Goldens: `core/fixtures/harbor.spec`,
 * `.claim-view`, `.tasks`, `.timeline` and `.docs.golden.json`; the evidence listing comes from the stub route.
 *
 * A counter the views expose without a stable hook is a `test.fixme` row whose reason names the missing hook; the
 * suite never edits the app to get one.
 */
import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import type { ClaimViewModel, EvidenceListing, SpecPageModel } from '../../core/src/files.ts';
import { type SpecRouteResponses, specRoutes } from '../../server/src/spec-routes.contract.ts';
import { atWidth, expect, test } from './fixtures';

type TasksBody = NonNullable<SpecRouteResponses['tasks']>;

function golden<T>(family: string): Record<string, T> {
  return JSON.parse(readFileSync(new URL(`../../core/fixtures/harbor.${family}.golden.json`, import.meta.url), 'utf8')) as Record<string, T>;
}

const SPEC = golden<SpecPageModel>('spec');
const CLAIMS = golden<ClaimViewModel>('claim-view');
const TASKS = golden<TasksBody | null>('tasks');
const TIMELINE = golden<readonly unknown[]>('timeline');
const DOCS = golden<unknown>('docs')['specs'] as Record<string, Record<string, unknown> | undefined>;

/** The goldens of one spec folder, each family keyed the way the parser writes it. */
interface Goldens {
  readonly spec: SpecPageModel;
  readonly claims: ClaimViewModel;
  readonly tasks: TasksBody | null;
  readonly timeline: readonly unknown[];
  readonly docs: Record<string, unknown>;
}

function goldensOf(folder: string): Goldens {
  const spec = SPEC[folder];
  const claims = CLAIMS[folder];
  const timeline = TIMELINE[folder];
  const docs = DOCS[folder];
  if (!spec || !claims || !timeline || !docs || !(folder in TASKS)) throw new Error(`a harbor golden holds no ${folder}`);
  return { spec, claims, tasks: TASKS[folder] ?? null, timeline, docs };
}

/** harbor 002 carries every view; 003 and 006 have no tasks.md, so their rows skip the Tasks tab. */
const FIXTURES = [
  { id: '002', folder: 'specs/002-web-console' },
  { id: '003', folder: 'specs/003-config-loader' },
  { id: '006', folder: 'specs/006-partial-push' },
] as const;

type Tier = 'compact' | 'wide';
const TIERS: ReadonlyArray<{ readonly width: number; readonly tier: Tier }> = [
  { width: 390, tier: 'compact' },
  { width: 1440, tier: 'wide' },
];

/**
 * One counter: `tab` is the route under `/w/harbor/s/<id>` ('' is the dashboard), `golden` the field it must equal
 * (it names the test), `selector` what reads it. `count` compares the number of matches; `text` the element's text
 * (whitespace-normalised); `texts` the texts of every match in order; `contains` a substring. `at` limits the row to
 * the tier that renders it; `fixme` names the hook the view lacks.
 */
interface Row {
  readonly tab: string;
  readonly what: string;
  readonly golden: string;
  readonly selector: string;
  readonly kind: 'count' | 'text' | 'texts' | 'contains';
  readonly want: string | number | RegExp | ReadonlyArray<string | RegExp>;
  readonly at?: Tier;
  readonly fixme?: string;
}

const n = (value: number) => String(value);
const pair = (a: number, b: number) => `${n(a)}/${n(b)}`;
const CLAIM_STATES = ['takeable', 'taken', 'blocked', 'closed', 'dropped'] as const;
const STATE_CHIPS = ['all', 'open', 'takeable', 'taken', 'blocked', 'closed', 'dropped'] as const;
const KIND_CHIPS = ['all', 'anti', 'antecedent'] as const;

function rowsFor(g: Goldens): readonly Row[] {
  const { keyNumbers: k, areas, lanes } = g.spec;
  const dash = 'app-spec-dashboard';
  const kpi = `${dash} [data-section="kpi"]`;
  const tile = (area: string, line: number) => `${dash} [data-area-tile="${area}"] .tile-line >> nth=${n(line)}`;
  const status = 'app-status-tab';
  const rows: Row[] = [
    // Spec dashboard: the KPI band.
    { tab: '', what: 'kpi claims closed/total', golden: 'spec.keyNumbers.claims.closed/total', selector: `${kpi} [data-kpi="claims"] .figure`, kind: 'text', want: pair(k.claims.closed, k.claims.total) },
    { tab: '', what: 'kpi claims open and takeable', golden: 'spec.keyNumbers.claims.open, .takeable', selector: `${kpi} [data-kpi="claims"] .meta`, kind: 'text', want: `${n(k.claims.open)} open · ${n(k.claims.takeable)} takeable` },
    { tab: '', what: 'kpi tasks landed/total', golden: 'spec.keyNumbers.tasks.landed/total', selector: `${kpi} [data-kpi="tasks"] .figure`, kind: 'text', want: pair(k.tasks.landed, k.tasks.total) },
    { tab: '', what: 'kpi rounds', golden: 'spec.keyNumbers.rounds.count', selector: `${kpi} [data-kpi="round"] .figure`, kind: 'text', want: n(k.rounds.count) },
    { tab: '', what: 'kpi agents working', golden: 'spec.keyNumbers.rounds.agentsWorking', selector: `${kpi} [data-kpi="round"] .meta`, kind: 'text', want: k.rounds.agentsWorking > 0 ? `${n(k.rounds.agentsWorking)} agents working` : 'No agent working' },
    { tab: '', what: 'kpi gates ok/total', golden: 'spec.keyNumbers.gates.ok/total', selector: `${kpi} [data-kpi="gates"] .figure`, kind: 'text', want: pair(k.gates.ok, k.gates.total) },
    { tab: '', what: 'kpi waiting', golden: 'spec.keyNumbers.waiting', selector: `${kpi} [data-kpi="waiting"] .figure`, kind: 'text', want: n(k.waiting) },
    // Spec dashboard: waiting, lanes, warnings and gates sections.
    { tab: '', what: 'waiting header count', golden: 'spec.keyNumbers.waiting', selector: `${dash} [data-section="waiting"] span[meta]`, kind: 'text', want: n(k.waiting) },
    { tab: '', what: 'waiting rows', golden: 'spec.waitingOnYou.length', selector: `${dash} [data-section="waiting"] .waiting-row`, kind: 'count', want: g.spec.waitingOnYou.length },
    { tab: '', what: 'lanes rows', golden: 'spec.lanes.length', selector: `${dash} [data-lane]`, kind: 'count', want: lanes.length },
    { tab: '', what: 'warnings header count', golden: 'spec.areas.status.warnings', selector: `${dash} [data-section="warnings"] span[meta]`, kind: 'text', want: n(areas.status.warnings) },
    { tab: '', what: 'warnings rows', golden: 'spec.warnings.length', selector: `${dash} [data-section="warnings"] [data-warning]`, kind: 'count', want: g.spec.warnings.length },
    { tab: '', what: 'gates rows', golden: 'spec.keyNumbers.gates.total', selector: `${dash} [data-section="gates"] [data-gate]`, kind: 'count', want: k.gates.total },
    // core counts a gate ok when its state is `fresh` or `ok` (`keyNumbers.gates.ok` in core/src/spec.ts).
    { tab: '', what: 'gates rows ok', golden: 'spec.keyNumbers.gates.ok', selector: `${dash} [data-section="gates"] [data-gate]:is([data-state="fresh"], [data-state="ok"])`, kind: 'count', want: k.gates.ok },
    // Spec dashboard: the area tiles' numbers.
    { tab: '', what: 'status tile timeline entries', golden: 'spec.areas.status.timelineEntries', selector: tile('status', 0), kind: 'text', want: `${n(areas.status.timelineEntries)} timeline entries` },
    { tab: '', what: 'status tile warnings', golden: 'spec.areas.status.warnings', selector: tile('status', 1), kind: 'text', want: `${n(areas.status.warnings)} warnings` },
    { tab: '', what: 'live tile agents working', golden: 'spec.areas.live.agentsWorking', selector: tile('live', 0), kind: 'text', want: areas.live.agentsWorking > 0 ? `${n(areas.live.agentsWorking)} agents working` : 'No agent working' },
    { tab: '', what: 'data tile claims', golden: 'spec.areas.data.claims.closed/total', selector: tile('data', 0), kind: 'text', want: `${pair(areas.data.claims.closed, areas.data.claims.total)} claims closed` },
    { tab: '', what: 'data tile tasks', golden: 'spec.areas.data.tasks.landed/total', selector: tile('data', 1), kind: 'text', want: areas.data.tasks ? `${pair(areas.data.tasks.landed, areas.data.tasks.total)} tasks landed` : 'No tasks.md yet' },
    { tab: '', what: 'docs tile decisions', golden: 'spec.areas.docs.decisions', selector: tile('docs', 1), kind: 'text', want: `${n(areas.docs.decisions)} decisions` },
    { tab: '', what: 'notes tile board rounds', golden: 'spec.areas.board.rounds', selector: tile('notes', 1), kind: 'text', want: `${n(areas.board.rounds)} rounds on the board` },
    // The tab bar of the Data area.
    { tab: '/claims', what: 'tab bar claims closed/total', golden: 'spec.areas.data.claims.closed/total', selector: 'app-tab-bar [data-count="claims"]', kind: 'text', want: pair(areas.data.claims.closed, areas.data.claims.total) },
    areas.data.tasks
      ? { tab: '/claims', what: 'tab bar tasks landed/total', golden: 'spec.areas.data.tasks.landed/total', selector: 'app-tab-bar [data-count="tasks"]', kind: 'text', want: pair(areas.data.tasks.landed, areas.data.tasks.total) }
      : { tab: '/claims', what: 'tab bar tasks count absent', golden: 'spec.areas.data.tasks (null)', selector: 'app-tab-bar [data-count="tasks"]', kind: 'count', want: 0 },
    // Status tab: compact renders the ring text, waiting and warnings; wide renders the lanes card.
    { tab: '/status', what: 'claims closed text', golden: 'spec.keyNumbers.claims.closed/total', selector: `${status} [data-claims-closed]`, kind: 'text', want: `${pair(k.claims.closed, k.claims.total)} claims closed`, at: 'compact' },
    { tab: '/status', what: 'takeable count', golden: 'spec.keyNumbers.claims.takeable', selector: `${status} [data-takeable]`, kind: 'contains', want: `${n(k.claims.takeable)} takeable` },
    { tab: '/status', what: 'waiting count', golden: 'spec.keyNumbers.waiting', selector: `${status} [data-section="waiting"] span[meta]`, kind: 'text', want: n(k.waiting), at: 'compact' },
    { tab: '/status', what: 'waiting rows', golden: 'spec.waitingOnYou.length', selector: `${status} [data-waiting-row]`, kind: 'count', want: g.spec.waitingOnYou.length, at: 'compact' },
    { tab: '/status', what: 'gates meta ok/total', golden: 'spec.keyNumbers.gates.ok/total', selector: `${status} [data-section="gates"] span[meta]`, kind: 'text', want: pair(k.gates.ok, k.gates.total) },
    { tab: '/status', what: 'gates rows', golden: 'spec.keyNumbers.gates.total', selector: `${status} [data-gate]`, kind: 'count', want: k.gates.total },
    { tab: '/status', what: 'warnings count', golden: 'spec.areas.status.warnings', selector: `${status} [data-section="warnings"] span[meta]`, kind: 'text', want: n(areas.status.warnings), at: 'compact' },
    { tab: '/status', what: 'warnings rows', golden: 'spec.warnings.length', selector: `${status} [data-section="warnings"] [data-warning]`, kind: 'count', want: g.spec.warnings.length, at: 'compact' },
    { tab: '/status', what: 'open claims count', golden: 'spec.keyNumbers.claims.open', selector: `${status} [data-section="open"] span[meta]`, kind: 'text', want: n(k.claims.open) },
    { tab: '/status', what: 'open claims rows', golden: 'claim-view.counts.open', selector: `${status} [data-open-claim]`, kind: 'count', want: g.claims.counts.open },
    { tab: '/status', what: 'fog rows', golden: 'claim-view.fog.length', selector: `${status} [data-fog]`, kind: 'count', want: g.claims.fog.length },
    { tab: '/status', what: 'lanes tasks landed/total', golden: 'spec.keyNumbers.tasks.landed/total', selector: `${status} [data-section="lanes"] .tasks-meter .count`, kind: 'text', want: pair(k.tasks.landed, k.tasks.total), at: 'wide' },
    { tab: '/status', what: 'lanes rows', golden: 'spec.lanes.length', selector: `${status} [data-section="lanes"] [data-lane]`, kind: 'count', want: lanes.length, at: 'wide' },
    // Claims tab: cards, cards per state, filter chip counts.
    { tab: '/claims', what: 'claim cards', golden: 'claim-view.counts.all', selector: 'app-claims-tab [data-claim]', kind: 'count', want: g.claims.counts.all },
    { tab: '/claims', what: 'claim cards open', golden: 'claim-view.counts.open', selector: 'app-claims-tab [data-claim]:not([data-state="closed"]):not([data-state="dropped"])', kind: 'count', want: g.claims.counts.open },
    ...CLAIM_STATES.map((state): Row => ({ tab: '/claims', what: `claim cards ${state}`, golden: `claim-view.counts.${state}`, selector: `app-claims-tab [data-claim][data-state="${state}"]`, kind: 'count', want: g.claims.counts[state] })),
    { tab: '/claims', what: 'state chip counts', golden: `claim-view.counts.{${STATE_CHIPS.join(',')}}`, selector: 'app-claims-tab [data-filter="state"] button .count', kind: 'texts', want: STATE_CHIPS.map((key) => n(g.claims.counts[key])) },
    { tab: '/claims', what: 'kind chip counts', golden: `claim-view.counts.{${KIND_CHIPS.join(',')}}`, selector: 'app-claims-tab [data-filter="kind"] button .count', kind: 'texts', want: KIND_CHIPS.map((key) => n(g.claims.counts[key])) },
    // Timeline tab.
    { tab: '/timeline', what: 'timeline entries', golden: 'timeline.length', selector: 'app-timeline-tab [data-entry]', kind: 'count', want: g.timeline.length },
    // Docs: the decisions page renders core's prose HTML; no element carries one decision each.
    {
      tab: '/decisions',
      what: 'decisions rows',
      golden: 'spec.areas.docs.decisions',
      selector: 'app-docs-tab[data-doc="decisions"] [data-decision]',
      kind: 'count',
      want: areas.docs.decisions,
      fixme: 'app-docs-tab has no per-decision hook (e.g. [data-decision]); decisions.md renders as one prose [innerHTML] block',
    },
  ];

  const lanesWithRows = lanes.length > 0;
  if (lanesWithRows) {
    rows.push(
      { tab: '', what: 'lanes n/m', golden: 'spec.lanes[].landed/total', selector: `${dash} [data-lane] .lane-count`, kind: 'texts', want: lanes.map((lane) => pair(lane.landed, lane.total)) },
      { tab: '/status', what: 'lanes n/m', golden: 'spec.lanes[].landed/total', selector: `${status} [data-section="lanes"] [data-lane] .count`, kind: 'texts', want: lanes.map((lane) => pair(lane.landed, lane.total)), at: 'wide' },
    );
  }

  const tasks = g.tasks;
  if (tasks) {
    rows.push(
      { tab: '/tasks', what: 'task rows', golden: 'tasks.counts.rows', selector: '[data-task-row]', kind: 'count', want: tasks.counts.rows },
      { tab: '/tasks', what: 'tasks landed/total', golden: 'tasks.counts.boxes.landed/total', selector: '[data-tasks-landed]', kind: 'contains', want: pair(tasks.counts.boxes.landed, tasks.counts.boxes.total) },
      { tab: '/tasks', what: 'task boxes', golden: 'tasks.counts.boxes.total', selector: '[data-task-row] input[type="checkbox"]', kind: 'count', want: tasks.counts.boxes.total },
      { tab: '/tasks', what: 'task boxes ticked', golden: 'tasks.counts.boxes.landed', selector: '[data-task-row] input[type="checkbox"]:checked', kind: 'count', want: tasks.counts.boxes.landed },
      { tab: '/tasks', what: 'lane chips', golden: 'tasks.counts.byLane.length', selector: '[data-filter="lane"] button', kind: 'count', want: tasks.counts.byLane.length + 1 },
      {
        tab: '/tasks',
        what: 'lane chip counts',
        golden: 'tasks.counts.byLane[].count',
        selector: '[data-filter="lane"] button',
        kind: 'texts',
        want: [/.*/, ...tasks.counts.byLane.map((lane) => new RegExp(`^\\s*${lane.name}\\s+${n(lane.count)}\\s*$`))],
      },
      { tab: '/tasks', what: 'probe mapping rows', golden: 'tasks.probeMapping.length', selector: '[data-mapping-row]', kind: 'count', want: tasks.probeMapping.length },
    );
  }
  return rows;
}

async function check(page: Page, row: Row): Promise<void> {
  const target = page.locator(row.selector);
  const label = `${row.what} ≠ ${row.golden}`;
  switch (row.kind) {
    case 'count':
      await expect(target, label).toHaveCount(row.want as number);
      return;
    case 'text':
      await expect(target, label).toHaveText(row.want as string | RegExp);
      return;
    case 'contains':
      await expect(target, label).toContainText(row.want as string);
      return;
    case 'texts':
      await expect(target, label).toHaveText(row.want as Array<string | RegExp>);
      return;
  }
}

for (const { width, tier } of TIERS) {
  test.describe(`counts at ${n(width)}`, () => {
    test.use(atWidth(width));

    for (const { id, folder } of FIXTURES) {
      const g = goldensOf(folder);
      const base = `/w/harbor/s/${id}`;

      for (const row of rowsFor(g)) {
        if (row.at && row.at !== tier) continue;
        const url = `${base}${row.tab}`;
        const name = `${url} ${row.what}`;
        if (row.fixme) {
          test.fixme(name, () => undefined);
          continue;
        }
        test(name, async ({ page }) => {
          await page.goto(url);
          await check(page, row);
        });
      }

      // Evidence tab: the listing is the stub route's answer (core's `listEvidence` over the fixture tree), so the rows
      // are read at run time: one [data-claim-group] per byClaim key plus `none` for the ungrouped files.
      test(`${base}/evidence files per group`, async ({ page, request }) => {
        const answer = await request.get(specRoutes.evidence('harbor', id));
        expect(answer.status()).toBe(200);
        const listing = (await answer.json()) as EvidenceListing;
        const groups: Array<[string, number]> = Object.entries(listing.byClaim).map(([claim, files]) => [claim, files.length]);
        if (listing.ungrouped.length > 0) groups.push(['none', listing.ungrouped.length]);
        await page.goto(`${base}/evidence`);
        await expect(page.locator('app-evidence-tab [data-file]'), 'files ≠ evidence.results + raw').toHaveCount(
          listing.results.length + listing.raw.length,
        );
        await expect(page.locator('app-evidence-tab [data-claim-group]'), 'groups ≠ evidence.byClaim + ungrouped').toHaveCount(groups.length);
        for (const [key, count] of groups) {
          const group = page.locator(`app-evidence-tab [data-claim-group="${key}"]`);
          await expect(group.locator('[data-file]'), `group ${key} files ≠ evidence.byClaim[${key}].length`).toHaveCount(count);
          await expect(group.locator('.evidence-count').first(), `group ${key} count ≠ evidence.byClaim[${key}].length`).toContainText(n(count));
        }
      });
    }
  });
}
