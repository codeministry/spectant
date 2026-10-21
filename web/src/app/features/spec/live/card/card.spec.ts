import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import type { CardState, FrameCard, FrameKind, TaskStep } from '../../../../../../../core/src/files';
import { ApiClient } from '../../../../core/api.service';
import { RefreshService } from '../../../../layout/shell/refresh.service';
import { CATALOGUES, LANGS } from '../../../../../i18n/catalogues';
import { ShellState } from '../../../../layout/shell/shell-state.service';
import { formatClock, formatClockSeconds } from '../../../../shared/time';
import { CARD_STATES } from '../../../../shared/ui/glyph/states';
import { BoardCard } from './card';
import { CardContext } from './card-context';
import { cardHistory, type HistoryFrame } from './card-history';

const base: FrameCard = { task: 'T14', claim: 'ISC-61', lane: 'web', text: 'tag-table: no overflow at 390 px', parallel: true, seam: false, state: 'fail', builder: 'Engineer', tries: 2, note: 'probe exit 1' };

const WORDS = (CATALOGUES.en as { states: { card: Record<CardState, string> } }).states.card;

const frame = (index: number, kind: FrameKind, label: string, cards: Array<Pick<FrameCard, 'task' | 'text' | 'state'>>): HistoryFrame => ({ index, kind, label, cards });

// Frames 0–1 hold another task under T14 (renumbered in a re-cut): none of its states is T14's history.
const FRAMES: HistoryFrame[] = [
  frame(0, 'dispatch', 'R1 dispatch', [{ task: 'T14', text: 'old task', state: 'dispatched' }]),
  frame(1, 'result', 'R1', [{ task: 'T14', text: 'old task', state: 'done' }]),
  frame(2, 'dispatch', 'R2 dispatch', [{ task: 'T14', text: base.text, state: 'dispatched' }]),
  frame(3, 'result', 'R2', [{ task: 'T14', text: base.text, state: 'fail' }]),
  frame(4, 'live', 'Live', [{ task: 'T14', text: base.text, state: 'absent' }]),
];

describe('cardHistory', () => {
  it('follows the id together with its text, in frame order, the live frame last', () => {
    expect(cardHistory([...FRAMES].reverse(), base)).toEqual([
      { frame: 2, kind: 'dispatch', label: 'R2 dispatch', state: 'dispatched' },
      { frame: 3, kind: 'result', label: 'R2', state: 'fail' },
      { frame: 4, kind: 'live', label: 'Live', state: 'absent' },
    ]);
  });

  it('is empty for a task no frame holds', () => {
    expect(cardHistory(FRAMES, { task: 'T99', text: 'x' })).toEqual([]);
  });
});

describe('BoardCard', () => {
  const tier = signal<'compact' | 'medium' | 'wide'>('wide');

  beforeEach(() => {
    const proto = HTMLDialogElement.prototype as unknown as Record<string, unknown>;
    proto['showModal'] = function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
    proto['close'] = function (this: HTMLDialogElement) {
      this.removeAttribute('open');
      this.dispatchEvent(new Event('close'));
    };
    tier.set('wide');
    TestBed.configureTestingModule({
      imports: [
        TranslocoTestingModule.forRoot({
          langs: CATALOGUES,
          translocoConfig: { availableLangs: [...LANGS], defaultLang: 'en' },
          preloadLangs: true,
        }),
      ],
      providers: [
        provideRouter([]),
        CardContext,
        { provide: RefreshService, useValue: { refreshes: signal(0) } },
        { provide: ShellState, useValue: { ws: signal('harbor'), specId: signal('002'), tier } },
        {
          provide: ApiClient,
          useValue: {
            frames: () => Promise.resolve({ kind: 'ok', body: FRAMES.slice(0, 4), etag: null, notModified: false }),
            live: () => Promise.resolve({ kind: 'ok', body: FRAMES[4], etag: null, notModified: false }),
          },
        },
      ],
    });
  });

  async function render(card: FrameCard, density?: 'comfortable' | 'compact') {
    const fixture = TestBed.createComponent(BoardCard);
    fixture.componentRef.setInput('card', card);
    if (density) fixture.componentRef.setInput('density', density);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;
    return { fixture, host, article: host.querySelector('article') as HTMLElement };
  }

  it('comfortable: three rows, the name "T14, ISC-61, fail, web", a 3 px edge in the state tone', async () => {
    const { article } = await render(base);
    expect(article.getAttribute('aria-label')).toBe('T14, ISC-61, fail, web');
    expect(article.querySelector('.r1 > ui-glyph svg[data-state="fail"]')).not.toBeNull();
    expect(article.querySelector('.r1 .id')?.textContent.trim()).toBe('T14');
    expect(article.querySelector('.r1 .claim')?.textContent.trim()).toBe('ISC-61');
    expect(article.querySelector('.r1 ui-state-chip[data-state="fail"]')?.textContent.trim()).toBe('fail');
    expect(article.querySelector('.text')?.textContent).toBe(base.text);
    // spec 024: prototype value (principal: the prototype wins) — the parallel mark sits in the head row as `P` (.pmark).
    expect(article.querySelector('.r1 [data-flag="parallel"]')?.textContent.trim()).toBe('P');
    expect([...article.querySelectorAll('.r3 [data-builder], .r3 [data-flag]')].map((el) => el.textContent)).toEqual(['Engineer', 'try 2', 'note']);
    expect(article.getAttribute('data-edge')).toBe('error');
    expect(article.style.getPropertyValue('--edge')).toMatch(/^var\(--/);
  });

  it('compact: two rows, glyph, id and state chip over the text; claim, builder and flags move to the detail', async () => {
    const { host, article } = await render(base, 'compact');
    expect(host.getAttribute('data-density')).toBe('compact');
    expect(article.querySelector('.r1 > ui-glyph svg[data-state="fail"]')).not.toBeNull();
    expect(article.querySelector('.r1 ui-state-chip[data-state="fail"]')).not.toBeNull();
    expect(article.querySelector('.claim')).toBeNull();
    expect(article.querySelector('.r3')).toBeNull();
    expect(article.children.length).toBe(2);
  });

  it('every one of the eleven states has its glyph, its chip word and a (shape, tone) pair of its own', async () => {
    const pairs = new Set<string>();
    for (const state of CARD_STATES) {
      const { article } = await render({ ...base, state });
      const glyph = article.querySelector('.r1 > ui-glyph') as HTMLElement;
      expect(glyph.querySelector(`svg[data-state="${state}"]`)).not.toBeNull();
      expect(article.querySelector(`ui-state-chip[data-state="${state}"]`)?.textContent.trim()).toBe(WORDS[state]);
      pairs.add(`${String(glyph.getAttribute('data-shape'))}/${String(glyph.getAttribute('data-tone'))}`);
    }
    expect(pairs.size).toBe(11);
  });

  it('the id opens the detail with claim, builder, tries, note and the state history across frames', async () => {
    const { fixture, article, host } = await render(base, 'compact');
    (article.querySelector('.id') as HTMLButtonElement).click();
    await fixture.whenStable();
    const detail = host.querySelector('[data-card-detail]') as HTMLElement;
    expect(detail.getAttribute('data-task')).toBe('T14');
    expect(detail.querySelector('[data-detail-builder]')?.textContent).toBe('Engineer');
    expect(detail.querySelector('[data-detail-tries]')?.textContent).toBe('2');
    expect(detail.querySelector('[data-detail-note]')?.textContent).toBe('probe exit 1');
    expect([...detail.querySelectorAll('[data-history] li')].map((li) => [li.getAttribute('data-history-frame'), li.getAttribute('data-history-state')])).toEqual([
      ['2', 'dispatched'],
      ['3', 'fail'],
      ['4', 'absent'],
    ]);
    expect(host.querySelector('ui-dialog')?.hasAttribute('data-fullscreen')).toBe(false);
  });

  it('spec 025: a waiting card held by a spec edge reads its reason through the catalogue, the blockers marked; other reasons as written', async () => {
    const { fixture, article, host } = await render({ ...base, state: 'waiting', reason: 'waits on 006, 042' });
    (article.querySelector('.id') as HTMLButtonElement).click();
    await fixture.whenStable();
    const waits = host.querySelector('[data-card-detail] [data-detail-waits]');
    expect(waits?.textContent.replace(/\s+/g, ' ').trim()).toBe('waits on 006, 042');
    expect([...(waits?.querySelectorAll('[data-blocker]') ?? [])].map((el) => el.getAttribute('data-blocker'))).toEqual(['006', '042']);
    const other = await render({ ...base, state: 'waiting', reason: 'after T1 still open' });
    (other.article.querySelector('.id') as HTMLButtonElement).click();
    await other.fixture.whenStable();
    expect(other.host.querySelector('[data-detail-waits]')).toBeNull();
    expect(other.host.querySelector('[data-card-detail] .cd-dl')?.textContent).toContain('after T1 still open');
  });

  it('the detail is full screen at the compact tier', async () => {
    tier.set('compact');
    const { fixture, article, host } = await render(base);
    (article.querySelector('.id') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(host.querySelector('ui-dialog')?.hasAttribute('data-fullscreen')).toBe(true);
  });

  describe('spec 015: agent steps (ISC-232)', () => {
    const at = (minute: number): string => `2026-10-19T12:${String(minute).padStart(2, '0')}:05Z`;
    const step = (kind: TaskStep['kind'], minute: number, extra: Partial<TaskStep> = {}): TaskStep => ({ kind, ts: at(minute), actor: 'a:claude:builder/T14', ...extra });
    const THREE: readonly TaskStep[] = [step('dispatch', 30), step('build', 31), step('probe', 32, { result: 'red' })];
    const TEN: readonly TaskStep[] = Array.from({ length: 10 }, (_, i) => step(i === 0 ? 'dispatch' : 'build', 10 + i));

    function withSteps(steps: readonly TaskStep[], live = true): CardContext {
      const context = TestBed.inject(CardContext);
      context.steps.set({ T14: steps, T99: [step('release', 50)] });
      context.live.set(live);
      return context;
    }

    it('the card names its latest step as a text line under the text, with HH:MM, no chip', async () => {
      withSteps(THREE);
      const { article } = await render(base);
      const line = article.querySelector('[data-card-latest-step]') as HTMLElement;
      expect(line).not.toBeNull();
      expect(line.getAttribute('data-step-kind')).toBe('probe');
      expect(line.getAttribute('data-step-result')).toBe('red');
      expect(line.querySelector('[data-step-word]')?.textContent.trim()).toBe('Probe red');
      expect(line.querySelector('[data-step-time]')?.textContent.trim()).toBe(formatClock(at(32), 'en'));
      expect(line.querySelector('ui-chip, ui-state-chip, button')).toBeNull();
      expect(line.previousElementSibling?.classList.contains('text')).toBe(true);
    });

    it('the line shows in the compact density and never in the step density', async () => {
      withSteps(THREE);
      const compact = await render(base, 'compact');
      expect(compact.article.querySelector('[data-card-latest-step]')).not.toBeNull();
      const fixture = TestBed.createComponent(BoardCard);
      fixture.componentRef.setInput('card', base);
      fixture.componentRef.setInput('density', 'step');
      await fixture.whenStable();
      expect((fixture.nativeElement as HTMLElement).querySelector('[data-card-latest-step]')).toBeNull();
    });

    it('a task without steps and a past frame on the scrubber show no step line', async () => {
      withSteps(THREE);
      const none = await render({ ...base, task: 'T15' });
      expect(none.article.querySelector('[data-card-latest-step]')).toBeNull();
      const context = withSteps(THREE, false);
      const past = await render(base);
      expect(past.article.querySelector('[data-card-latest-step]')).toBeNull();
      context.live.set(true);
      await past.fixture.whenStable();
      expect(past.article.querySelector('[data-card-latest-step]')).not.toBeNull();
    });

    it('a new step swaps the line in place (a fresh node, cross-faded), the claim release reads its own word', async () => {
      const context = withSteps(THREE);
      const { fixture, article } = await render(base);
      const before = article.querySelector('[data-card-latest-step]');
      context.steps.set({ T14: [...THREE, step('release', 40)] });
      await fixture.whenStable();
      const after = article.querySelector('[data-card-latest-step]') as HTMLElement;
      expect(after).not.toBe(before);
      expect(after.getAttribute('data-step-kind')).toBe('release');
      const word = after.querySelector('[data-step-word]')?.textContent.trim();
      expect(word).toBe('Claim released');
      // ISC-226's run release, the app's write of spec 040, reads a different word.
      expect(word).not.toBe('Run released');
    });

    it('the detail shows the last 8 steps in app-step-timeline and links the full list in the Tasks tab', async () => {
      withSteps(TEN);
      const { fixture, article, host } = await render(base);
      (article.querySelector('.id') as HTMLButtonElement).click();
      await fixture.whenStable();
      const section = host.querySelector('[data-card-detail] [data-detail-steps]') as HTMLElement;
      expect(section).not.toBeNull();
      const rows = [...section.querySelectorAll('app-step-timeline [data-step-timeline] > li')];
      expect(rows.length).toBe(8);
      expect(rows[0]?.querySelector('[data-step-time]')?.textContent.trim()).toBe(formatClockSeconds(at(12), 'en'));
      expect(rows[7]?.hasAttribute('data-step-latest')).toBe(true);
      const more = section.querySelector('a[data-detail-steps-more]') as HTMLAnchorElement;
      expect(more.getAttribute('href')).toBe('/w/harbor/s/002/tasks?steps=T14#task-T14');
      expect(more.textContent.trim()).toBe('All 10 steps in the Tasks tab');
    });

    it('the detail lists every step of a short timeline without a link, and drops the section without steps', async () => {
      withSteps(THREE);
      const short = await render(base);
      (short.article.querySelector('.id') as HTMLButtonElement).click();
      await short.fixture.whenStable();
      expect(short.host.querySelectorAll('[data-detail-steps] [data-step-timeline] > li').length).toBe(3);
      expect(short.host.querySelector('[data-detail-steps-more]')).toBeNull();
      const none = await render({ ...base, task: 'T15' });
      (none.article.querySelector('.id') as HTMLButtonElement).click();
      await none.fixture.whenStable();
      expect(none.host.querySelector('[data-card-detail]')).not.toBeNull();
      expect(none.host.querySelector('[data-detail-steps]')).toBeNull();
    });
  });
});
