import { TestBed } from '@angular/core/testing';
import { TranslocoService, TranslocoTestingModule } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';
import frames from '../../../../../../../core/fixtures/harbor.frames.golden.json';
import live from '../../../../../../../core/fixtures/harbor.live.golden.json';
import type { Frame, LiveFrame, NeedsYouCard, TaskSteps } from '../../../../../../../core/src/files';
import { formatClock } from '../../../../shared/time';
import { CATALOGUES, LANGS } from '../../../../../i18n/catalogues';
import { frameEvents } from '../board/board-model';
import { AgentChip } from './agent-chip';
import { ALERT_PLACEHOLDERS, alertParts, BREAKABLE, NeedsYou } from './needs-you';
import { ThisFrame } from './this-frame';

const LIVE = live['specs/002-web-console'] as unknown as LiveFrame;
const HISTORY = (frames['specs/002-web-console'] as unknown as Frame[]).at(-1) as Frame;

beforeEach(() => {
  TestBed.configureTestingModule({
    imports: [
      TranslocoTestingModule.forRoot({
        langs: CATALOGUES,
        translocoConfig: { availableLangs: [...LANGS], defaultLang: 'en' },
        preloadLangs: true,
      }),
    ],
  });
});

async function render(type: typeof AgentChip | typeof ThisFrame | typeof NeedsYou, inputs: Record<string, unknown>): Promise<HTMLElement> {
  const fixture = TestBed.createComponent<unknown>(type);
  for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
  await fixture.whenStable();
  return fixture.nativeElement as HTMLElement;
}

describe('AgentChip', () => {
  it('shows the session, a relative time over since and the stale marker only when stale', async () => {
    const since = new Date(Date.now() - 3 * 60_000 - 5_000).toISOString();
    const fresh = await render(AgentChip, { session: 'spec-002-ISC-75', since, stale: false });
    expect(fresh.querySelector('[data-agent-session]')?.textContent).toContain('spec-002-ISC-75');
    expect(fresh.querySelector('time[data-agent-elapsed]')?.getAttribute('datetime')).toBe(since);
    expect(fresh.querySelector('time[data-agent-elapsed]')?.textContent).toBe('3 minutes ago');
    expect(fresh.querySelector('[data-agent-stale]')).toBeNull();

    const stale = await render(AgentChip, { session: 'spec-002-ISC-74', since, stale: true });
    expect(stale.querySelector('[data-agent-stale]')?.textContent.trim()).toBe('stale');
  });
});

describe('ThisFrame', () => {
  it('lists the cards that changed since the previous frame, the lock source and the agents of the live frame', async () => {
    const events = frameEvents(HISTORY, LIVE);
    const root = await render(ThisFrame, { frame: LIVE, events });
    const rows = [...root.querySelectorAll('[data-frame-event]')].map((row) => row.getAttribute('data-frame-event'));
    expect(rows).toEqual(events.map((c) => c.task));
    // spec 024: the prototype .fevents line, "T9 → closed · ISC-330", a button that opens the card.
    const first = events.at(0);
    if (first === undefined) throw new Error('the goldens hold no frame event');
    const words = (CATALOGUES.en as { states: { card: Record<string, string> } }).states.card;
    const line = root.querySelector('[data-frame-event]');
    expect(line?.tagName).toBe('BUTTON');
    expect(line?.textContent.replace(/\s+/g, ' ').trim()).toBe(`${first.task} → ${words[first.state] ?? ''} · ${first.claim}`);
    expect(root.querySelector('[data-lock-source]')?.getAttribute('data-lock-source')).toBe(LIVE.lockSource);
    expect(root.querySelector('[data-lock-source]')?.textContent).toContain(LIVE.lockSource);
    expect(root.querySelectorAll('[data-agents] app-agent-chip').length).toBe(LIVE.agents.length);
  });

  it('names no lock source for a history frame and says when nothing changed', async () => {
    const root = await render(ThisFrame, { frame: HISTORY, events: [] });
    expect(root.querySelector('[data-lock-source]')).toBeNull();
    expect(root.textContent).toContain('Nothing changed in this frame.');
  });
});

describe('NeedsYou', () => {
  it('counts the model list, renders each card with a 4 px edge row and raises the stale-agent alert', async () => {
    const root = await render(NeedsYou, { frame: LIVE, cards: LIVE.needsYou });
    expect(root.querySelector('[data-needs-count]')?.textContent.trim()).toBe(String(LIVE.needsYou.length));
    const cards = [...root.querySelectorAll('[data-needs-card]')].map((c) => c.getAttribute('data-needs-card'));
    expect(cards).toEqual(LIVE.needsYou.map((c) => c.task));
    const stale = LIVE.agents.filter((a) => a.stale);
    expect(root.querySelectorAll('[data-stale-agent]').length).toBe(stale.length);
    for (const agent of stale) {
      const ids = [...root.querySelectorAll(`[data-stale-agent][data-session="${agent.session}"] p [data-alert-id]`)].map((el) => el.textContent);
      expect(ids).toEqual([agent.session, ...agent.claims]);
    }
  });
});

describe('one session in two lock sources', () => {
  const agent = LIVE.agents.find((a) => a.stale);
  const twin = agent === undefined ? undefined : { ...agent, source: agent.source === 'frontier' ? ('activity' as const) : ('frontier' as const) };

  /** Renders a frame, then a frame with the twin agent and a reordered one, so the lists reconcile twice. */
  async function renderTwice(type: typeof NeedsYou | typeof ThisFrame, inputs: Record<string, unknown>): Promise<{ root: HTMLElement; said: string[] }> {
    if (agent === undefined || twin === undefined) throw new Error('the live fixture holds no stale agent');
    const frame = { ...LIVE, agents: [...LIVE.agents, twin] };
    const warn = vi.spyOn(console, 'warn');
    const error = vi.spyOn(console, 'error');
    try {
      const fixture = TestBed.createComponent<unknown>(type);
      for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
      fixture.componentRef.setInput('frame', LIVE);
      await fixture.whenStable();
      // A frame update re-runs the lists' reconciliation, where Angular reports duplicate track keys (NG0955).
      fixture.componentRef.setInput('frame', frame);
      await fixture.whenStable();
      fixture.componentRef.setInput('frame', { ...frame, agents: [...frame.agents].reverse() });
      await fixture.whenStable();
      const said = [...warn.mock.calls, ...error.mock.calls].map((args) => args.map(String).join(' '));
      return { root: fixture.nativeElement as HTMLElement, said };
    } finally {
      warn.mockRestore();
      error.mockRestore();
    }
  }

  it('NeedsYou raises one alert per source and session, never a duplicate track key', async () => {
    const { root, said } = await renderTwice(NeedsYou, { cards: LIVE.needsYou });
    const sources = [...root.querySelectorAll(`[data-stale-agent][data-session="${agent?.session ?? ''}"]`)].map((el) => el.getAttribute('data-source'));
    expect(sources.sort()).toEqual([agent?.source, twin?.source].sort());
    expect(said.filter((line) => line.includes('NG0955'))).toEqual([]);
  });

  it('ThisFrame lists the agent once per source and session, never a duplicate track key', async () => {
    const { root, said } = await renderTwice(ThisFrame, { events: [] });
    expect(root.querySelectorAll('[data-agents] app-agent-chip').length).toBe(LIVE.agents.length + 1);
    expect(said.filter((line) => line.includes('NG0955'))).toEqual([]);
  });
});

describe('alertParts', () => {
  /** The catalogue's sentence translated by transloco with the component's placeholders, as `alerts` hands it on. */
  async function sentence(lang: 'en' | 'de'): Promise<string> {
    const transloco = TestBed.inject(TranslocoService);
    await firstValueFrom(transloco.selectTranslation(lang));
    return transloco.translate('board.agent.staleAlert', ALERT_PLACEHOLDERS, lang);
  }
  const parts = async (lang: 'en' | 'de'): Promise<ReturnType<typeof alertParts>> =>
    alertParts(await sentence(lang), 'spec-002-ISC-74', ['ISC-74', 'ISC-75', 'ISC-76'], new Intl.ListFormat(lang, { type: 'conjunction' }));
  const runText = (part: ReturnType<typeof alertParts>[number]): string => (part.kind === 'run' ? part.pieces.map((x) => x.text).join('') : part.text);
  const join = (all: ReturnType<typeof alertParts>): string => all.map(runText).join('');

  it('puts the session and every claim back as id parts, joined by the app language list', async () => {
    const en = await parts('en');
    expect(en.flatMap((p) => (p.kind === 'run' ? p.pieces.filter((x) => x.id).map((x) => x.text) : []))).toEqual(['spec-002-ISC-74', 'ISC-74', 'ISC-75', 'ISC-76']);
    expect(join(en)).toBe('No release from spec-002-ISC-74 on ISC-74, ISC-75, and ISC-76: the agent may have stopped.');
    const de = await parts('de');
    expect(join(de)).toBe('Keine Freigabe von spec-002-ISC-74 für ISC-74, ISC-75 und ISC-76: Der Agent ist womöglich beendet.');
  });

  it('keeps the punctuation after an id in its run, so no line starts with it', async () => {
    const runs = (await parts('en')).filter((p) => p.kind === 'run');
    expect(runs.map(runText)).toEqual(['spec-002-ISC-74', 'ISC-74,', 'ISC-75,', 'ISC-76:']);
  });

  const S = ALERT_PLACEHOLDERS.session;
  const C = ALERT_PLACEHOLDERS.claims;
  /** Splits the joined sentence into the tokens CSS would keep together: a no-break space does not separate. */
  const tokensOf = (text: string): string[] => text.split(new RegExp(`${BREAKABLE}+`));
  const endsOpen = new RegExp(`${BREAKABLE}$`);
  const startsOpen = new RegExp(`^${BREAKABLE}`);
  const idsOf = (all: ReturnType<typeof alertParts>): string[] => all.flatMap((p) => (p.kind === 'run' ? p.pieces.filter((x) => x.id).map((x) => x.text) : []));

  it('token rule: each run is exactly a whitespace-delimited token, ids sharing a token share a run', () => {
    for (const lang of ['en', 'de'] as const) {
      const joiner = new Intl.ListFormat(lang, { type: 'conjunction' });
      for (const sentence of [`(${S}) on ${C}.`, `„${S}“ for ${C}.`, `${S}-session for ${C}`, `${S}’s ${C}:`, `${S}, ${C}: x`, `${S}/${C}`, `«\u202F${S}\u202F» ${C}`]) {
        const all = alertParts(sentence, 'spec-1', ['ISC-1', 'ISC-2'], joiner);
        const joined = join(all);
        expect(joined, sentence).toBe(sentence.replace(S, 'spec-1').replace(C, joiner.format(['ISC-1', 'ISC-2'])));
        expect(idsOf(all), sentence).toEqual(['spec-1', 'ISC-1', 'ISC-2']);
        const tokens = tokensOf(joined);
        for (const run of all.filter((p) => p.kind === 'run')) expect(tokens, `${lang} ${sentence}`).toContain(runText(run));
        all.forEach((p, i) => {
          if (p.kind !== 'text') return;
          if (all[i + 1]?.kind === 'run') expect(p.text, sentence).toMatch(endsOpen);
          if (all[i - 1]?.kind === 'run') expect(p.text, sentence).toMatch(startsOpen);
        });
      }
    }
    const shared = alertParts(`${S}/${C}`, 'spec-1', ['ISC-1'], new Intl.ListFormat('en', { type: 'conjunction' }));
    expect(shared.filter((p) => p.kind === 'run').map(runText)).toEqual(['spec-1/ISC-1']);
  });

  it('touching marks: opening marks before an id and closing marks or letters after it are in its run, in en and de', () => {
    for (const lang of ['en', 'de'] as const) {
      const joiner = new Intl.ListFormat(lang, { type: 'conjunction' });
      const and = lang === 'en' ? 'and' : 'und';
      const quoted = alertParts(`„${S}“ (${C}).`, 'spec-1', ['ISC-1', 'ISC-2'], joiner);
      expect(quoted.filter((p) => p.kind === 'run').map(runText), lang).toEqual(['„spec-1“', '(ISC-1', 'ISC-2).']);
      expect(join(quoted), lang).toBe(`„spec-1“ (ISC-1 ${and} ISC-2).`);
      const owned = alertParts(`${S}’s ${C}`, 'spec-1', ['ISC-1'], joiner);
      expect(owned.filter((p) => p.kind === 'run').map(runText), lang).toEqual(['spec-1’s', 'ISC-1']);
      for (const all of [quoted, owned]) {
        for (const p of all) {
          if (p.kind !== 'text') continue;
          expect(p.text, lang).not.toMatch(/[\p{Ps}\p{Pi}]$/u);
          expect(p.text, lang).not.toMatch(/^[\p{Pe}\p{Pf}\p{Po}]/u);
        }
      }
    }
  });
});

describe('NeedsYou with an open question (spec 015, ISC-232.1)', () => {
  const card = LIVE.cards.find((c) => c.task === 'T26');
  if (card === undefined) throw new Error('the live fixture holds no card T26');
  const ts = '2026-03-08T16:02:00Z';
  const asking = 'a:claude:sess-2/T26';
  // 200 characters, the most core keeps: shown in full, never cut.
  const text = `Should the export keep the old column order for existing reports, or switch to the new order everywhere? ${'x'.repeat(200)}`.slice(0, 200);
  const open: NeedsYouCard = { ...card, question: { text, ts } };
  const steps: TaskSteps = {
    [card.task]: [
      { kind: 'build', ts: '2026-03-08T15:55:00Z', actor: 'a:claude:parent' },
      { kind: 'question', ts, actor: asking, text },
    ],
  };
  const withQuestion = [open, ...LIVE.needsYou.filter((c) => c.task !== card.task)];
  const frame = { ...LIVE, needsYou: withQuestion, steps };
  const words = CATALOGUES.en as { steps: { kind: Record<string, string> } };

  for (const framed of [true, false]) {
    it(`shows the question in full with HH:MM and the asking session's agent chip (${framed ? 'rail' : 'sheet'})`, async () => {
      const root = await render(NeedsYou, { frame, cards: withQuestion, framed });
      const row = root.querySelector(`[data-needs-question="${card.task}"]`);
      expect(row).not.toBeNull();
      expect(row?.querySelector('[data-question-text]')?.textContent.trim()).toBe(text);
      const time = row?.querySelector('time');
      expect(time?.getAttribute('datetime')).toBe(ts);
      expect(time?.textContent).toBe(formatClock(ts, 'en'));
      expect(row?.textContent).toContain(words.steps.kind['question']);
      expect(row?.querySelector('app-agent-chip [data-agent-session]')?.textContent).toBe(asking);
      // No answer action: nothing to type into, and the only control opens the card.
      expect(row?.querySelectorAll('input, textarea').length).toBe(0);
      expect(row?.querySelectorAll('button').length).toBe(1);
      // The question card leads the list and is listed once.
      const listed = [...root.querySelectorAll('[data-needs-card]')].map((c) => c.getAttribute('data-needs-card'));
      expect(listed).toEqual(withQuestion.map((c) => c.task));
    });
  }

  it("falls back to the card's lock session when the frame carries no steps", async () => {
    const locked: NeedsYouCard = { ...open, lock: { source: 'activity', session: 'a:claude:lock-holder' } };
    const root = await render(NeedsYou, { frame: LIVE, cards: [locked] });
    expect(root.querySelector(`[data-needs-question="${card.task}"] app-agent-chip [data-agent-session]`)?.textContent).toBe('a:claude:lock-holder');
  });

  it('announces a newly asked question once and nothing else', async () => {
    const fixture = TestBed.createComponent(NeedsYou);
    fixture.componentRef.setInput('frame', LIVE);
    fixture.componentRef.setInput('cards', LIVE.needsYou);
    await fixture.whenStable();
    const region = (): string => (fixture.nativeElement as HTMLElement).querySelector('ui-live-region[data-needs-announcer]')?.textContent ?? 'missing';
    expect(region()).toBe('');

    fixture.componentRef.setInput('frame', frame);
    fixture.componentRef.setInput('cards', withQuestion);
    await fixture.whenStable();
    const said = region();
    expect(said).toContain(card.task);
    expect(said).toContain(text);

    // Another step or a reordered list announces nothing new.
    fixture.componentRef.setInput('frame', { ...frame, steps: { ...steps, T99: [{ kind: 'build', ts, actor: asking }] } });
    fixture.componentRef.setInput('cards', [...withQuestion].reverse());
    await fixture.whenStable();
    expect(region()).toBe(said);
  });

  it('does not announce a question that was already open when it first rendered', async () => {
    const root = await render(NeedsYou, { frame, cards: withQuestion, framed: false });
    expect(root.querySelector('ui-live-region[data-needs-announcer]')?.textContent).toBe('');
  });
});
