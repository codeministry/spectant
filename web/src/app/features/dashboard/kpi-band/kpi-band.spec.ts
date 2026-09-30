import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslocoService, TranslocoTestingModule } from '@jsverse/transloco';
import harbor from '../../../../../../core/fixtures/harbor.golden.json';
import { CATALOGUES, LANGS } from '../../../../i18n/catalogues';
import { type KpiBandModel, KpiBand } from './kpi-band';

// The golden snapshot of the harbor fixture is the model the server sends; the band must take it as it is.
const HARBOR: KpiBandModel = harbor;

describe('KpiBand', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [
        TranslocoTestingModule.forRoot({
          langs: CATALOGUES,
          translocoConfig: { availableLangs: [...LANGS], defaultLang: 'en', reRenderOnLangChange: true },
          preloadLangs: true,
        }),
      ],
      providers: [provideRouter([])],
    });
  });

  async function render(model: KpiBandModel = HARBOR, ws = 'harbor') {
    const fixture = TestBed.createComponent(KpiBand);
    fixture.componentRef.setInput('model', model);
    fixture.componentRef.setInput('ws', ws);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;
    const squash = (node: Element | null | undefined) => node?.textContent.replace(/\s+/g, ' ').trim();
    const tile = (kpi: string) => host.querySelector<HTMLElement>(`.band [data-kpi="${kpi}"]`);
    const text = (kpi: string, part: string) => squash(tile(kpi)?.querySelector(part));
    const card = (kpi: string) => tile(kpi)?.querySelector('ui-card');
    const pulse = host.querySelector<HTMLElement>('[data-kpi="pulse"]');
    return { fixture, host, tile, text, card, pulse, squash };
  }

  it('renders the key numbers of the model as they are', async () => {
    const { text } = await render();

    expect(text('master', '.figure')?.replace(/ /g, '')).toBe('101/124');
    expect(text('master', '.meta')).toBe('81 % closed · 23 open');
    expect(text('master', 'ui-ring .text')?.replace(/ /g, '')).toBe('81%');
    expect(text('claims', '.figure')?.replace(/ /g, '')).toBe('55/78');
    expect(text('specs', '.value')).toBe('5');
    expect(text('takeable', '.value')).toBe('4');
    expect(text('attention', '.value')).toBe('11');
    expect(text('attention', '.meta')).toBe('7 warnings · 4 open fog');
    expect(text('archive', '.value')).toBe('1');
  });

  it('ports the prototype tiles: hero ring 112, lime claims meter, "Takeable now", attention wide, no reserved slot', async () => {
    const { host, tile, text } = await render();
    const claimsMeter = tile('claims')?.querySelector('ui-meter');

    expect(tile('master')?.querySelector('ui-ring')?.getAttribute('data-size')).toBe('112');
    expect(claimsMeter?.getAttribute('aria-valuenow')).toBe('55');
    expect(claimsMeter?.querySelector('.fill')?.getAttribute('style')).toContain('--color-accent');
    expect(text('takeable', '.eyebrow-text')).toBe('Takeable now');
    expect(tile('attention')?.classList.contains('span-wide')).toBe(true);
    expect(host.querySelector('[data-kpi="activity"]')).toBeNull();
    expect([...host.querySelectorAll('.band > [data-kpi]')].map((node) => node.getAttribute('data-kpi'))).toEqual([
      'master',
      'claims',
      'specs',
      'takeable',
      'attention',
      'archive',
    ]);
  });

  it('gives every tile the prototype edge and glow: hero glow only, then lime, cyan, cyan, orange, violet', async () => {
    const { card } = await render();
    const look = (kpi: string) => ({
      edge: card(kpi)?.hasAttribute('data-edge'),
      glow: card(kpi)?.hasAttribute('data-glow'),
      tone: card(kpi)?.getAttribute('data-accent') ?? null,
    });

    expect(look('master')).toEqual({ edge: false, glow: true, tone: null });
    expect(look('claims')).toEqual({ edge: true, glow: true, tone: 'accent' });
    expect(look('specs')).toEqual({ edge: true, glow: true, tone: 'primary' });
    expect(look('takeable')).toEqual({ edge: true, glow: true, tone: 'primary' });
    expect(look('attention')).toEqual({ edge: true, glow: true, tone: 'warning' });
    expect(look('archive')).toEqual({ edge: true, glow: true, tone: 'secondary' });
  });

  it('makes every tile with a destination one link on /w/:ws, its target as query state and fragment', async () => {
    const { tile } = await render();
    const href = (kpi: string) => tile(kpi)?.querySelector('a.tile')?.getAttribute('href') ?? null;

    expect(href('specs')).toBe('/w/harbor#specs');
    expect(href('takeable')).toBe('/w/harbor?sort=next&takeable=1#specs');
    expect(href('attention')).toBe('/w/harbor#warnings');
    expect(href('archive')).toBe('/w/harbor#archive');
    expect(href('master')).toBeNull();
    expect(href('claims')).toBeNull();
  });

  it('splits the specs meter by phase and lists only the phases present, name before count', async () => {
    const { tile, squash } = await render();
    const specs = tile('specs');
    const legend = [...(specs?.querySelectorAll('.legend .entry') ?? [])].map((entry) => squash(entry));

    expect(specs?.querySelector('ui-meter')?.getAttribute('aria-label')).toBe('Specs');
    expect(legend).toEqual(['building 2', 'scoping 3']);
  });

  it('carries the Pulse card for the compact form: ring 72, master fraction, spec-claims meter and three stat links', async () => {
    const { pulse, squash } = await render();
    const stats = [...(pulse?.querySelectorAll<HTMLAnchorElement>('.stats a') ?? [])].map((link) => ({
      label: squash(link.querySelector('.type-eyebrow')),
      value: squash(link.querySelector('b')),
      href: link.getAttribute('href'),
    }));

    expect(pulse?.querySelector('ui-card')?.hasAttribute('data-glow')).toBe(true);
    expect(pulse?.querySelector('ui-card')?.hasAttribute('data-edge')).toBe(false);
    expect(pulse?.querySelector('ui-ring')?.getAttribute('data-size')).toBe('72');
    expect(squash(pulse?.querySelector('.figure'))?.replace(/ /g, '')).toBe('101/124');
    expect(squash(pulse?.querySelector('.claims-row .type-eyebrow'))).toBe('Spec claims');
    expect(squash(pulse?.querySelector('.claims-row .frac'))).toBe('55/78');
    expect(pulse?.querySelector('.claims ui-meter')?.getAttribute('aria-valuenow')).toBe('55');
    expect(stats).toEqual([
      { label: 'Specs', value: '5', href: '/w/harbor#specs' },
      { label: 'Takeable', value: '4', href: '/w/harbor?sort=next&takeable=1#specs' },
      { label: 'Attention', value: '11', href: '/w/harbor#warnings' },
    ]);
  });

  it('shows a dash for a workspace without a master and keeps the tile calm', async () => {
    const empty: KpiBandModel = {
      kpis: { ...HARBOR.kpis, master: null, specs: 0, building: 0, scoping: 0, takeable: 0, warnings: 0, fog: 0, attention: 0 },
    };
    const { tile, text, pulse, squash } = await render(empty);

    expect(text('master', '.figure')).toBe('—');
    expect(text('master', 'ui-ring .text')).toBe('—');
    expect(tile('master')?.querySelector('.meta')).toBeNull();
    expect(tile('specs')?.querySelectorAll('.legend .entry').length).toBe(0);
    expect(squash(pulse?.querySelector('.figure'))).toBe('—');
  });

  it('follows the active language', async () => {
    const { fixture, text } = await render();
    TestBed.inject(TranslocoService).setActiveLang('de');
    await fixture.whenStable();
    expect(text('master', '.meta')).toBe('81 % geschlossen · 23 offen');
  });
});
