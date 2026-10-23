import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { TranslocoTestingModule } from '@jsverse/transloco';
import dashboard from '../../../../../core/fixtures/harbor.golden.json';
import planningGolden from '../../../../../core/fixtures/harbor.planning.golden.json';
import beacon from '../../../../../core/fixtures/beacon.golden.json';
import type { Guidance, ItemStateInfo, Worktree } from '../../../../../core/src/files';
import type { PlanningModel } from '../../../../../core/src/planning';
import { CATALOGUES, LANGS } from '../../../i18n/catalogues';
import { ShellData } from '../../layout/shell/shell-data.service';
import { ShellState } from '../../layout/shell/shell-state.service';
import { BoardCard } from './board-card';
import type { BoardRow } from '../../core/model/board-rows';
import { type BoardCard as BoardCardModel } from '../../core/model/board-types';
import { buildBoard } from '../../core/model/board';

// T122 · ISC-129 / ISC-131 / ISC-122.3: one board card's anatomy, rendered from the harbor board as `buildBoard` builds
// it: the type glyph and number (or the idea chip's look), the priority, the feature, milestone and assignee chips,
// the reason line on waiting cards only, the decorative grip, the `ui-card` variants and the one link.

const BOARD = buildBoard({
  planning: planningGolden as unknown as PlanningModel,
  rows: dashboard.specs as unknown as readonly BoardRow[],
  actors: [{ id: 'u:3f9c0a7d', displayName: 'Harbor maintainer' }],
});
const cardOf = (key: string): BoardCardModel => {
  const found = BOARD.cards.find((c) => c.id === key || c.slug === key);
  if (!found) throw new Error(`no card ${key}`);
  return found;
};

async function render(key: string, card: BoardCardModel = cardOf(key)): Promise<HTMLElement> {
  TestBed.configureTestingModule({
    imports: [
      TranslocoTestingModule.forRoot({
        langs: CATALOGUES,
        translocoConfig: { availableLangs: [...LANGS], defaultLang: 'en' },
        preloadLangs: true,
      }),
    ],
    // The real DetailSelection over the address; the shell services it reads lazily are stubbed (spec 026, T26).
    providers: [provideRouter([]), { provide: ShellData, useValue: { planningModel: () => null } }, { provide: ShellState, useValue: { tier: () => 'wide' } }],
  });
  const fixture = TestBed.createComponent(BoardCard);
  fixture.componentRef.setInput('card', card);
  fixture.componentRef.setInput('ws', 'harbor');
  await fixture.whenStable();
  return fixture.nativeElement as HTMLElement;
}

const text = (el: Element | null | undefined): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('BoardCard (T122, ISC-129)', () => {
  it('renders 008 close-pending: number, title link, F6, the reason line without a command chip', async () => {
    const host = await render('008');
    const c = cardOf('008');
    expect(host.dataset['stage']).toBe('close-pending');
    expect(host.querySelector('ui-type-glyph')?.getAttribute('data-type')).toBe('spike');
    expect(text(host.querySelector('.num'))).toBe('008');
    const link = host.querySelector<HTMLAnchorElement>('a.title');
    expect(link?.getAttribute('href')).toBe('/w/harbor/s/008');
    expect(text(link)).toBe(c.title);
    expect(link?.getAttribute('aria-label')).toBe(`Spec 008, spike, ${c.title}, priority ${c.priority}, stage Close-pending`);
    const described = host.querySelector(`[id="${link?.getAttribute('aria-describedby') ?? '-'}"]`);
    expect(text(described)).toBe('waits: every claim is closed and F6 waits on spec 009');
    expect(text(host.querySelector('.feat'))).toBe('F6');
    expect(host.querySelector('.feat')?.getAttribute('title')).toBe('Feature F6: Registry compatibility');
    // Spec 040 (T48): the state line replaces the reason line; 008 waits on its sibling 009, without a command.
    expect(host.querySelector('ui-reason')).toBeNull();
    const state = host.querySelector<HTMLElement>('[data-card-state] ui-item-state');
    expect(state?.dataset['state']).toBe('waiting');
    expect(text(state?.querySelector('[data-item-line]'))).toBe('Close-pending · waiting');
    expect(text(state?.querySelector('ui-waits-chip a[data-waits]'))).toBe('waits on 009');
    expect(state?.querySelector('ui-command-chip')).toBeNull();
    expect(host.querySelector('.r3 ui-actor-chip')?.textContent).toContain('Harbor maintainer');
  });

  it('renders 006 with its P1 priority and the violet edge of a wait on you, with the command chip', async () => {
    const host = await render('006');
    expect(host.querySelector('ui-priority')?.getAttribute('data-level')).toBe('P1');
    const card = host.querySelector<HTMLElement>('ui-card');
    expect(card?.hasAttribute('data-side')).toBe(true);
    expect(card?.hasAttribute('data-dashed')).toBe(false);
    expect(card?.style.getPropertyValue('--edge')).toBe('var(--color-secondary)');
    const chip = host.querySelector('[data-card-state] ui-item-state[data-state="open"] ui-command-chip');
    expect(chip?.textContent).toContain(cardOf('006').command ?? '-');
    expect(text(host.querySelector('[data-item-line]'))).toBe('Review · open');
  });

  it('renders a story with the dashed card, the idea look (lightbulb, slug) and a link to its idea page', async () => {
    const host = await render('registry-webhooks');
    const c = cardOf('registry-webhooks');
    const card = host.querySelector<HTMLElement>('ui-card');
    expect(card?.hasAttribute('data-dashed')).toBe(true);
    expect(card?.style.getPropertyValue('--edge')).toBe('var(--teal)');
    expect(host.querySelector('.num')).toBeNull();
    expect(text(host.querySelector('.idea .slug'))).toBe('registry-webhooks');
    expect(host.querySelector('.idea ui-icon')).not.toBeNull();
    const link = host.querySelector<HTMLAnchorElement>('a.title');
    expect(link?.getAttribute('href')).toBe('/w/harbor/ideas/registry-webhooks');
    expect(link?.getAttribute('aria-label')).toBe(`Idea, ${c.title}, priority P2`);
    expect(link?.hasAttribute('aria-describedby')).toBe(false);
    expect(host.querySelector('ui-reason')).toBeNull();
    expect(text(host.querySelector('.ms'))).toBe('Harbor 1.0');
    // Spec 040 (T48): the story's open state carries the chip `/spec new <slug>`.
    const state = host.querySelector<HTMLElement>('[data-card-state] ui-item-state');
    expect(state?.dataset['state']).toBe('open');
    expect(text(state?.querySelector('[data-item-line]'))).toBe('Idea · open');
    expect(state?.querySelector('ui-command-chip')?.textContent).toContain('/spec new registry-webhooks');
  });

  it('shows no assignee chip on a card nobody holds, and the raw id for an unmapped person', async () => {
    expect(cardOf('004').assignee).toBeNull();
    const host = await render('004');
    expect(host.querySelector('ui-actor-chip')).toBeNull();
    TestBed.resetTestingModule();
    const unmapped = buildBoard({
      planning: planningGolden as unknown as PlanningModel,
      rows: dashboard.specs as unknown as readonly BoardRow[],
    }).cards.find((c) => c.id === '002');
    expect(unmapped?.assigneeName).toBeNull();
  });

  it('has exactly one link and, at the trailing edge, the grip as the "Move to…" button (T127)', async () => {
    const host = await render('002');
    expect(host.querySelectorAll('a')).toHaveLength(1);
    const grip = host.querySelector<HTMLButtonElement>('[data-grip]');
    expect(grip?.tagName).toBe('BUTTON');
    expect(grip?.getAttribute('type')).toBe('button');
    expect(grip?.getAttribute('aria-label')).toBe('Move 002');
    expect(grip?.getAttribute('aria-haspopup')).toBe('dialog');
    expect(grip?.querySelector('ui-icon')).not.toBeNull();
    expect(host.querySelector('ui-reason')).toBeNull();
  });

  it('a story\'s grip is named by its slug', async () => {
    const host = await render('registry-webhooks');
    expect(host.querySelector('[data-grip]')?.getAttribute('aria-label')).toBe('Move registry-webhooks');
  });
});

// T36 · ISC-175 (spec 027, design.md § Across viewports 6, Mobile G, Desktop 7): a spec with a worktree shows the
// compact, non-interactive worktree chip in the assignee row, before the assignee pill; the row's
// `worktree-branch-mismatch` warning turns it to the warning tone; a spec without a worktree and a story show none.
describe('BoardCard worktree chip (T36, ISC-175)', () => {
  const WORKTREE_002: Worktree = { path: '.worktrees/002-web-console', branch: 'feature/002-web-console', spec: '002', ahead: 2, dirty: true, kind: 'spec' };
  const WORKTREE_003: Worktree = { path: '.worktrees/003-config-loader', branch: 'feature/005-config-format-choice', spec: '003', ahead: 1, dirty: false, kind: 'spec' };
  const MISMATCH = { kind: 'worktree-branch-mismatch', text: 'branch names another spec', ref: WORKTREE_003.path };
  const rows = (dashboard.specs as unknown as readonly BoardRow[]).map((row): BoardRow => {
    if (row.id === '002') return { ...row, worktree: WORKTREE_002 };
    if (row.id === '003') return { ...row, worktree: WORKTREE_003, warnings: [...(row.warnings ?? []), MISMATCH] };
    return row;
  });
  const board = buildBoard({ planning: planningGolden as unknown as PlanningModel, rows });
  const withWorktrees = (key: string): BoardCardModel => {
    const found = board.cards.find((c) => c.id === key || c.slug === key);
    if (!found) throw new Error(`no card ${key}`);
    return found;
  };

  it('the board model carries the row\'s worktree and its mismatch onto the card, null and false elsewhere', () => {
    expect(withWorktrees('002')).toMatchObject({ worktree: WORKTREE_002, worktreeMismatch: false });
    expect(withWorktrees('003')).toMatchObject({ worktree: WORKTREE_003, worktreeMismatch: true });
    expect(withWorktrees('004')).toMatchObject({ worktree: null, worktreeMismatch: false });
    expect(withWorktrees('registry-webhooks')).toMatchObject({ worktree: null, worktreeMismatch: false });
  });

  it('002: the compact chip, not a button, in the assignee row before the pill, ↑2 and ± and the sentence', async () => {
    const host = await render('002', withWorktrees('002'));
    const chip = host.querySelector<HTMLElement>('.r3 .who > ui-worktree-chip');
    expect(chip).not.toBeNull();
    expect(chip?.dataset['form']).toBe('compact');
    expect(chip?.hasAttribute('data-mismatch')).toBe(false);
    expect(chip?.querySelector('button')).toBeNull();
    expect(chip?.querySelector('ui-popover, ui-sheet')).toBeNull();
    expect(text(chip?.querySelector('.ahead'))).toBe('↑2');
    expect(text(chip?.querySelector('.dirty'))).toBe('±');
    expect(text(chip?.querySelector('.vh'))).toBe(
      'Worktree .worktrees/002-web-console, branch feature/002-web-console, 2 commits ahead of main, uncommitted changes',
    );
    expect(chip?.querySelector('ui-chip')?.getAttribute('data-tone')).toBe('neutral');
    const row = [...(host.querySelector('.r3 .who')?.children ?? [])].map((el) => el.localName);
    if (row.includes('ui-actor-chip')) expect(row.indexOf('ui-worktree-chip')).toBe(row.indexOf('ui-actor-chip') - 1);
  });

  it('003: the row\'s worktree-branch-mismatch warning gives the chip the warning tone', async () => {
    const host = await render('003', withWorktrees('003'));
    const chip = host.querySelector<HTMLElement>('.r3 .who > ui-worktree-chip');
    expect(chip?.hasAttribute('data-mismatch')).toBe(true);
    expect(chip?.querySelector('ui-chip')?.getAttribute('data-tone')).toBe('warning');
    expect(chip?.querySelector('.dirty')).toBeNull();
    expect(text(chip?.querySelector('.ahead'))).toBe('↑1');
  });

  it('004 without a worktree and a story show no chip', async () => {
    expect((await render('004', withWorktrees('004'))).querySelector('ui-worktree-chip')).toBeNull();
    TestBed.resetTestingModule();
    expect((await render('registry-webhooks', withWorktrees('registry-webhooks'))).querySelector('ui-worktree-chip')).toBeNull();
  });
});

describe('BoardCard selection (spec 026, T26, ISC-171)', () => {
  const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
  const click = (el: Element | null, init: MouseEventInit = {}): MouseEvent => {
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init });
    el?.dispatchEvent(event);
    return event;
  };

  it('names the object on the title link: data-ref spec:NNN, idea:<slug>', async () => {
    const host = await render('008');
    expect(host.querySelector('a.title')?.getAttribute('data-ref')).toBe('spec:008');
    TestBed.resetTestingModule();
    const idea = await render('registry-webhooks');
    expect(idea.querySelector('a.title')?.getAttribute('data-ref')).toBe('idea:registry-webhooks');
  });

  it('a plain click (or Enter) on the card surface selects (?sel=) instead of opening the spec page', async () => {
    const host = await render('008');
    const event = click(host.querySelector('a.title'));
    await settle();
    expect(event.defaultPrevented).toBe(true);
    expect(TestBed.inject(Router).url).toBe('/?sel=spec:008');
  });

  it('Shift+Enter (a shift click on the link) opens the spec page', async () => {
    const host = await render('008');
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const event = click(host.querySelector('a.title'), { shiftKey: true });
    await settle();
    expect(event.defaultPrevented).toBe(true);
    expect(navigate).toHaveBeenCalledWith(['/w', 'harbor', 's', '008']);
    expect(TestBed.inject(Router).url).toBe('/');
  });

  it('marks the selected card with data-selected="card"', async () => {
    const host = await render('008');
    expect(host.querySelector('ui-card')?.getAttribute('data-selected')).toBeNull();
    await TestBed.inject(Router).navigateByUrl('/?sel=spec:008');
    TestBed.tick();
    expect(host.querySelector('ui-card')?.getAttribute('data-selected')).toBe('card');
  });
});

// Spec 025, T23 · ISC-163 (design.md § Workspace board card): a held spec's card carries "waits on NNN" in its own line
// right under the title, above the feature row; each chip links to its blocker spec on its own, outside the title link;
// the partial scope stays in the accessible name; a card nothing holds shows no line.
// Spec 040 (T48) supersedes spec 025 T23's "own line under the title at every width": the waits chip now stands in the
// state line (row 4), at every width, and is left out where the state is `waiting`, whose line names the blockers.
describe('BoardCard waits chip in the state line (T23, ISC-163; spec 040 T48)', () => {
  const held = buildBoard({
    planning: planningGolden as unknown as PlanningModel,
    rows: (dashboard.specs as unknown as readonly BoardRow[]).map((row) =>
      row.id === '003' || row.id === '008' ? { ...row, waits: { spec: row.id, blockers: ['002'], heldTasks: 2, readyTasks: 1, openTasks: 3, full: false } } : row,
    ),
  });
  const heldCard = (id: string): BoardCardModel => held.cards.find((c) => c.id === id) as BoardCardModel;

  it('builds the wait and the blocker title into the card, and nothing for a card no edge holds', () => {
    const card = heldCard('003');
    expect(card.waits?.blockers).toEqual(['002']);
    expect(card.waitTitles).toEqual({ '002': heldCard('002').title });
    expect(heldCard('002').waits).toBeNull();
    expect(heldCard('002').waitTitles).toEqual({});
  });

  it('shows the chip in the state line after the open state, linked to 002, outside the title link, after the feature row', async () => {
    const host = await render('003', heldCard('003'));
    const line = host.querySelector<HTMLElement>('ui-waits-chip[data-card-waits]');
    expect(line).not.toBeNull();
    const title = host.querySelector<HTMLAnchorElement>('a.title');
    expect(line?.parentElement?.hasAttribute('data-card-state')).toBe(true);
    expect(line?.previousElementSibling?.tagName).toBe('UI-ITEM-STATE');
    expect(line?.parentElement?.previousElementSibling?.classList.contains('r3')).toBe(true);
    const chip = line?.querySelector<HTMLAnchorElement>('a[data-waits]');
    expect(text(chip)).toBe('waits on 002');
    expect(chip?.getAttribute('href')).toBe('/w/harbor/s/002');
    expect(chip?.closest('a.title')).toBeNull();
    expect(chip?.getAttribute('aria-label')).toBe(`Waits on spec 002, ${heldCard('002').title}, 2 waiting · 1 open`);
    expect(line?.querySelector('[data-waits-meta]')).toBeNull();
    expect(title?.getAttribute('aria-describedby')?.split(' ')).toContain(line?.id);
  });

  it('shows no waits chip on a card nothing holds', async () => {
    const host = await render('002', heldCard('002'));
    expect(host.querySelector('ui-waits-chip')).toBeNull();
  });

  it('says "waits" once on a waiting card: the state line names its blockers, the edge chip stays out', async () => {
    const host = await render('008', heldCard('008'));
    expect(host.querySelector('[data-card-waits]')).toBeNull();
    expect(host.querySelectorAll('ui-waits-chip')).toHaveLength(1);
    expect(host.querySelector('a.title')?.getAttribute('aria-describedby')).toBe(`bc-${heldCard('008').key}-waits`);
  });
});

// Spec 040 (T48, ISC-224): every card shows its state line from the API, a running card its run as a band; a card
// without a state keeps the reason line; the edge stays the stage's.
describe('BoardCard state line (spec 040, T48, ISC-224)', () => {
  const beaconRun = (beacon.specs as unknown as ReadonlyArray<{ id: string; state: ItemStateInfo }>).find((r) => r.id === '003')?.state as ItemStateInfo;
  const running: BoardCardModel = { ...cardOf('003'), state: beaconRun };

  it('a running card shows "Tasks · running · since 8 min", the locked chip and the agent, banded, on the stage edge', async () => {
    const host = await render('003', running);
    const line = host.querySelector<HTMLElement>('[data-card-state]');
    expect(line?.dataset['run']).toBe('running');
    expect(text(line?.querySelector('[data-item-line]'))).toBe('Tasks · running · since 8 min');
    expect(line?.querySelector('ui-command-chip')?.textContent).toContain('/spec tasks 003');
    expect(line?.querySelector('ui-actor-chip')?.textContent).toContain('a:claude:sess-32');
    expect(host.querySelector<HTMLElement>('ui-card')?.style.getPropertyValue('--edge')).toBe('var(--track)');
  });

  it('every harbor card carries the state its row or story serves', () => {
    for (const c of BOARD.cards) {
      const served = c.kind === 'idea' ? 'open' : dashboard.specs.find((r) => r.id === c.id)?.state.state;
      expect(c.state?.state, c.key).toBe(served);
    }
  });

  it('a card without a state keeps the reason line on a waiting card, and no state line elsewhere', async () => {
    const host = await render('008', { ...cardOf('008'), state: null });
    expect(host.querySelector('ui-item-state')).toBeNull();
    expect(host.querySelector('[data-card-state] ui-reason')?.hasAttribute('data-compact')).toBe(true);
    TestBed.resetTestingModule();
    const plain = await render('002', { ...cardOf('002'), state: null });
    expect(plain.querySelector('[data-card-state]')).toBeNull();
  });
});

describe('BoardCard "Waits on you" marker and reason (spec 020, T23, ISC-240)', () => {
  const GUIDED = buildBoard({
    planning: planningGolden as unknown as PlanningModel,
    rows: dashboard.specs as unknown as readonly BoardRow[],
    guidance: dashboard.guidance as unknown as Guidance,
    actors: [],
  });
  const guided = (id: string): BoardCardModel => {
    const found = GUIDED.cards.find((c) => c.id === id);
    if (!found) throw new Error(`no card ${id}`);
    return found;
  };
  const waits = new Set(dashboard.guidance.waits.filter((e) => e.item === 'spec').map((e) => e.spec));

  it('marks exactly the cards whose spec has its own entry in guidance.waits; Next, waiting and done cards are unmarked', () => {
    for (const c of GUIDED.cards) expect(c.marked ?? false, c.key).toBe(c.kind === 'spec' && waits.has(c.id ?? ''));
    expect([...waits].sort()).toEqual(['004', '005', '006']);
    expect(BOARD.cards.some((c) => c.marked)).toBe(false);
  });

  it('keeps the mark when the fold puts the spec entry under an older claim of the same spec (spec 070, ISC-568)', () => {
    // Harbor's 005 stands as its spec entry with claim ISC-94 folded under it; core puts the claim in front and folds
    // the spec entry instead when the claim waits longer. The same two entries, swapped, are that case.
    const source = dashboard.guidance as unknown as Guidance;
    const swapped: Guidance = {
      ...source,
      waits: source.waits.map((e) => {
        const under = e.spec === '005' ? (e.folded ?? []) : [];
        if (under.length === 0) return e;
        const [claim, ...rest] = under;
        const front = { ...e, folded: undefined };
        delete front.folded;
        return { ...claim, folded: [front, ...rest] };
      }),
    };
    expect(swapped.waits.find((e) => e.spec === '005')?.item).toBe('claim');
    const folded = buildBoard({
      planning: planningGolden as unknown as PlanningModel,
      rows: dashboard.specs as unknown as readonly BoardRow[],
      guidance: swapped,
      actors: [],
    });
    expect(folded.cards.filter((c) => c.marked).map((c) => c.id).sort()).toEqual(['004', '005', '006']);
  });

  it('006 in review: the marker row (secondary, user-round) right above the state line, the whole sentence, then the chip', async () => {
    const host = await render('006', guided('006'));
    const marker = host.querySelector<HTMLElement>('[data-card-marker]');
    const chip = marker?.querySelector('ui-chip');
    expect(text(chip)).toBe('Waits on you');
    expect(chip?.getAttribute('data-tone')).toBe('secondary');
    expect(chip?.getAttribute('data-variant')).toBe('status');
    expect(chip?.querySelector('ui-icon')?.getAttribute('data-icon')).toBe('user-round');
    expect(marker?.nextElementSibling?.hasAttribute('data-card-state')).toBe(true);
    const state = host.querySelector('[data-card-state] ui-item-state');
    expect(state?.hasAttribute('data-reasoned')).toBe(true);
    const shown = state?.querySelector('[data-reason-shown]');
    expect(text(shown)).toBe('Read the spec and confirm it: your review is out of date, and building needs it.');
    expect(shown?.nextElementSibling?.tagName.toLowerCase()).toBe('ui-command-chip');
    expect(host.querySelector('a.title')?.getAttribute('aria-describedby')).not.toContain(marker?.id ?? '?');
  });

  it('a Next card (002 in build) carries its sentence without the marker; a waiting card (008) neither', async () => {
    const host = await render('002', guided('002'));
    expect(host.querySelector('[data-card-marker]')).toBeNull();
    expect(text(host.querySelector('[data-reason-shown]'))).toBe('Start the next implementation round: claims are ready to build.');
    TestBed.resetTestingModule();
    const held = await render('008', guided('008'));
    expect(held.querySelector('[data-card-marker]')).toBeNull();
    expect(held.querySelector('[data-reason-shown]')).toBeNull();
  });
});
