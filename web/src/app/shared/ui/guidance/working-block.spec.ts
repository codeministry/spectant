import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslocoService, TranslocoTestingModule } from '@jsverse/transloco';
import { describe, expect, it } from 'vitest';
import type { WorkingEntry } from '../../../core/model/working';
import { CATALOGUES, LANGS } from '../../../../i18n/catalogues';
import { UiWorkingBlock } from './working-block';

// T15 · ISC-460, ISC-461, ISC-462: the block "In progress" over `workingOf`'s entries — nothing at all without an
// entry, one flat tile per spec (dot, id, title, agent) linking to the spec, at most TILE_LIMIT tiles and then the
// "Show all n" link to the filtered spec list.
const entry = (id: string, title: string, session: string): WorkingEntry => ({ id, title, session, since: null });
const ONE = [entry('002', 'Gate reviewed mark', 'a:claude:spec-002/T3')];
const FOUR = [
  ...ONE,
  entry('005', 'Board stage moves', 'a:claude:spec-005/T1'),
  entry('006', 'Token measurement', 'a:codex:spec-006/T2'),
  entry('009', 'Backlog route', 'a:claude:spec-009/T4'),
];

async function render(entries: readonly WorkingEntry[], lang: 'en' | 'de' = 'en') {
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
  const fixture = TestBed.createComponent(UiWorkingBlock);
  fixture.componentRef.setInput('entries', entries);
  fixture.componentRef.setInput('workspace', 'harbor');
  fixture.componentRef.setInput('level', 2);
  fixture.componentRef.setInput('headingId', 'working-heading');
  await fixture.whenStable();
  return fixture.nativeElement as HTMLElement;
}

const text = (el: Element | null | undefined): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('ui-working-block (T15, ISC-460)', () => {
  it('renders nothing without an entry: no section, no heading (ISC-462)', async () => {
    const host = await render([]);
    expect(host.children).toHaveLength(0);
    expect(host.querySelector('section, h2, h3')).toBeNull();
  });

  it('shows one tile per held claim: dot, id, title, agent, link and name (ISC-460)', async () => {
    const host = await render(ONE);
    const section = host.querySelector('section');
    expect(section?.getAttribute('aria-labelledby')).toBe('working-heading');
    const heading = host.querySelector('h2#working-heading');
    expect(text(heading)).toBe('In progress');
    expect(host.querySelector('ui-section-header ui-glyph[data-family="item"]')).not.toBeNull();
    expect(text(host.querySelector('ui-section-header ui-chip'))).toBe('1');

    const tiles = host.querySelectorAll('ol.tiles > li ui-flat-tile');
    expect(tiles).toHaveLength(1);
    const tile = tiles[0];
    const dot = tile.querySelector('ui-agent-dot');
    expect(dot).not.toBeNull();
    expect(dot?.getAttribute('aria-hidden')).toBe('true');
    expect(text(tile.querySelector('[data-id]'))).toBe('002');
    expect(text(tile.querySelector('[data-title]'))).toBe('Gate reviewed mark');
    const agent = tile.querySelector('[data-agent]');
    expect(text(agent)).toBe('a:claude:spec-002/T3');
    expect(agent?.getAttribute('title')).toBe('a:claude:spec-002/T3');
    const link = tile.querySelector('a');
    expect(link?.getAttribute('href')).toBe('/w/harbor/s/002');
    expect(link?.getAttribute('aria-label')).toBe('002 Gate reviewed mark, agent a:claude:spec-002/T3 working');
    expect(link?.getAttribute('title')).toBe('Gate reviewed mark');
    expect(host.querySelector('[data-show-all]')).toBeNull();
  });

  it('caps the list at three tiles and links "Show all 4" to the filtered spec list (ISC-461)', async () => {
    const host = await render(FOUR);
    expect(host.querySelectorAll('ol.tiles > li ui-flat-tile')).toHaveLength(3);
    expect(text(host.querySelector('ui-section-header ui-chip'))).toBe('4');
    const more = host.querySelector('a[data-show-all]');
    expect(more?.getAttribute('href')).toBe('/w/harbor/specs?working=1');
    expect(text(more)).toBe('Show all 4');
    expect(more?.getAttribute('aria-label')).toBe('Show all 4 · In progress');
    expect(more?.querySelector('ui-icon')).not.toBeNull();
  });

  it('speaks German formally', async () => {
    const host = await render(FOUR, 'de');
    expect(text(host.querySelector('h2'))).toBe('In Arbeit');
    expect(text(host.querySelector('a[data-show-all]'))).toBe('Alle 4 anzeigen');
    expect(host.querySelector('ui-flat-tile a')?.getAttribute('aria-label')).toBe(
      '002 Gate reviewed mark, Agent a:claude:spec-002/T3 arbeitet',
    );
  });
});
