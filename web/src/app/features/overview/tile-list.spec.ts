import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslocoService, TranslocoTestingModule } from '@jsverse/transloco';
import { describe, expect, it } from 'vitest';
import type { GuidanceEntry } from '../../../../../core/src/files';
import { CATALOGUES, LANGS } from '../../../i18n/catalogues';
import type { WorkingEntry } from '../../core/model/working';
import { type TileList as TileListModel, tileOf } from './overview-model';
import { TileList } from './tile-list';

// Spec 066 T5 · ISC-518: the list area of a tile on `/` — both counters always, at most three rows (in progress before
// waiting), one empty line without an entry, the foot always reserved and "Show all n" to `/w/<ws>` past three.
const working = (id: string, session = `a:claude:spec-${id}/T1`): WorkingEntry => ({ id, title: `Working ${id}`, session, since: null });
const waiting = (spec: string, over: Partial<GuidanceEntry> = {}): GuidanceEntry =>
  ({
    spec,
    item: 'claim',
    ref: 'ISC-77',
    title: `Claim of ${spec}`,
    reason: 'manual-claim',
    priority: 'P1',
    command: `/spec review ${spec}`,
    since: '2026-09-27T10:00:00Z',
    ...over,
  }) as GuidanceEntry;

const many = (n: number, offset = 0): GuidanceEntry[] => Array.from({ length: n }, (_, i) => waiting(String(100 + offset + i)));

async function render(tile: TileListModel, lang: 'en' | 'de' = 'en'): Promise<HTMLElement> {
  TestBed.configureTestingModule({
    imports: [
      TranslocoTestingModule.forRoot({
        langs: CATALOGUES,
        translocoConfig: { availableLangs: [...LANGS], defaultLang: lang },
        preloadLangs: true,
      }),
    ],
    providers: [provideRouter([])],
  });
  TestBed.inject(TranslocoService).setActiveLang(lang);
  const fixture = TestBed.createComponent(TileList);
  fixture.componentRef.setInput('tile', tile);
  fixture.componentRef.setInput('workspace', 'harbor');
  fixture.componentRef.setInput('name', 'Harbor');
  await fixture.whenStable();
  return fixture.nativeElement as HTMLElement;
}

const text = (el: Element | null | undefined): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const rows = (host: HTMLElement): HTMLElement[] => [...host.querySelectorAll<HTMLElement>('li[data-tile-row]')];
const counter = (host: HTMLElement, kind: 'working' | 'waits'): string => text(host.querySelector(`[data-tile-count="${kind}"]`));

describe('app-tile-list (spec 066 T5, ISC-518)', () => {
  it('0 entries: both counters at 0, one empty line, no row, the foot reserved without a link', async () => {
    const host = await render(tileOf([], [], {}));
    expect(counter(host, 'working')).toBe('In progress 0');
    expect(counter(host, 'waits')).toBe('Waits on you 0');
    expect(rows(host)).toHaveLength(0);
    expect(host.querySelectorAll('[data-tile-empty]')).toHaveLength(1);
    expect(text(host.querySelector('[data-tile-empty]'))).toBe('Nothing is waiting on you.');
    expect(host.querySelectorAll('[data-tile-foot]')).toHaveLength(1);
    expect(host.querySelector('a[data-tile-more]')).toBeNull();
    expect(host.querySelectorAll('li:not([data-tile-row])')).toHaveLength(0);
  });

  it('1 waiting entry: one waiting row with glyph, id, ref, spec title, icon chip and short time; no empty line', async () => {
    const host = await render(tileOf([], [waiting('002')], { '002': 'Gate reviewed mark' }));
    const [row] = rows(host);
    expect(rows(host)).toHaveLength(1);
    expect(row.dataset['kind']).toBe('waiting');
    expect(row.dataset['id']).toBe('002');
    expect(row.querySelector('a[data-tile-link]')?.getAttribute('href')).toBe('/w/harbor/s/002');
    expect(row.querySelector('ui-glyph')).not.toBeNull();
    expect(text(row.querySelector('[data-ref]'))).toBe('ISC-77');
    expect(row.querySelector('ui-chip')).toBeNull();
    const title = row.querySelector('[data-title]');
    expect(text(title)).toBe('Gate reviewed mark');
    expect(title?.getAttribute('title')).toBe('Gate reviewed mark');
    expect(row.querySelector('ui-command-chip[data-icon-only]')).not.toBeNull();
    expect(row.querySelector('ui-command-chip')?.closest('a')).toBeNull();
    expect(row.querySelector('ui-relative-time')).not.toBeNull();
    expect(host.querySelector('[data-tile-empty]')).toBeNull();
    expect(counter(host, 'working')).toBe('In progress 0');
    expect(counter(host, 'waits')).toBe('Waits on you 1');
    expect(host.querySelector('a[data-tile-more]')).toBeNull();
  });

  it('a waiting entry without a command shows no copy chip', async () => {
    const host = await render(tileOf([], [waiting('002', { command: null })], {}));
    expect(host.querySelector('ui-command-chip')).toBeNull();
  });

  it('3 entries: in progress before waiting, an in-progress row links to its spec live view, a waiting row to its spec, no "Show all"', async () => {
    const host = await render(tileOf([working('005'), working('006', 'a:codex:session-with-a-long-name')], [waiting('002')], {}));
    expect(rows(host).map((r) => [r.dataset['kind'], r.dataset['id']])).toEqual([
      ['working', '005'],
      ['working', '006'],
      ['waiting', '002'],
    ]);
    expect(rows(host).map((r) => r.querySelector('a[data-tile-link]')?.getAttribute('href'))).toEqual([
      '/w/harbor/s/005/board',
      '/w/harbor/s/006/board',
      '/w/harbor/s/002',
    ]);
    const second = rows(host)[1];
    expect(second.querySelector('ui-agent-dot')).not.toBeNull();
    const session = second.querySelector('[data-session]');
    expect(text(session)).toBe('a:codex:session-with-a-long-name');
    expect(session?.getAttribute('title')).toBe('a:codex:session-with-a-long-name');
    expect(second.querySelector('ui-command-chip')).toBeNull();
    expect(host.querySelector('[data-tile-foot]')).not.toBeNull();
    expect(host.querySelector('a[data-tile-more]')).toBeNull();
  });

  it('16 entries: three rows, the counters count all, "Show all 16" links to /w/<ws> in the foot', async () => {
    const host = await render(tileOf([working('005'), working('006'), working('002'), working('009')], many(12), {}));
    expect(rows(host)).toHaveLength(3);
    expect(rows(host).every((r) => r.dataset['kind'] === 'working')).toBe(true);
    expect(counter(host, 'working')).toBe('In progress 4');
    expect(counter(host, 'waits')).toBe('Waits on you 12');
    const more = host.querySelector('[data-tile-foot] a[data-tile-more]');
    expect(more?.getAttribute('href')).toBe('/w/harbor');
    expect(text(more)).toBe('Show all 16');
    expect(more?.getAttribute('aria-label')).toBe('Show all 16 in Harbor');
    expect(host.querySelectorAll('li:not([data-tile-row])')).toHaveLength(0);
  });

  it('speaks German formally', async () => {
    const host = await render(tileOf([], many(4), {}), 'de');
    expect(counter(host, 'working')).toBe('In Arbeit 0');
    expect(counter(host, 'waits')).toBe('Liegt bei Ihnen 4');
    expect(text(host.querySelector('a[data-tile-more]'))).toBe('Alle 4 anzeigen');
  });
});
