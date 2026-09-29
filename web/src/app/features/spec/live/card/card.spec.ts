import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import type { CardState, FrameCard, FrameKind } from '../../../../../../../core/src/files';
import { ApiClient } from '../../../../core/api.service';
import { CATALOGUES, LANGS } from '../../../../../i18n/catalogues';
import { ShellState } from '../../../../layout/shell/shell-state.service';
import { CARD_STATES } from '../../../../shared/ui/glyph/states';
import { BoardCard } from './card';
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
    expect([...article.querySelectorAll('.r3 [data-builder], .r3 [data-flag]')].map((el) => el.textContent)).toEqual(['Engineer', 'parallel', 'try 2', 'note']);
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

  it('the detail is full screen at the compact tier', async () => {
    tier.set('compact');
    const { fixture, article, host } = await render(base);
    (article.querySelector('.id') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(host.querySelector('ui-dialog')?.hasAttribute('data-fullscreen')).toBe(true);
  });
});
