import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslocoService, TranslocoTestingModule } from '@jsverse/transloco';
import harbor from '../../../../../../core/fixtures/harbor.golden.json';
import { CATALOGUES, LANGS, type Lang } from '../../../../i18n/catalogues';
import { ShellState } from '../../../layout/shell/shell-state.service';
import { type KpiBandModel, KpiBand } from './kpi-band';

// The fields the band read before the references existed, from the golden snapshot of the harbor fixture.
const { specs, master, claims, takeable, warnings, fog } = harbor.kpis;
const BARE: KpiBandModel = { kpis: { specs, master, claims, takeable, warnings, fog } };
// The references core derives for harbor (core/tests/dashboard.test.ts, `kpi-band`), set here so the band is probed
// against a model with warnings, fog and an archived spec whatever the golden carries yet.
const REFS = { stageGroups: { scoping: 3, building: 4, complete: 1 }, openClaims: 24, specsWithWarnings: 5, specsWithFog: 1, masterFog: 2 };
const HARBOR: KpiBandModel = { kpis: { ...harbor.kpis, ...REFS } };
// The expected figures are read from the model, so the specs follow the fixture as it grows.
const K = { ...harbor.kpis, ...REFS };
const MASTER = `${String(K.master.closed)}/${String(K.master.total)}`;
const CLAIMS = `${String(K.claims.closed)}/${String(K.claims.total)}`;
const PCT = String(Math.floor((K.master.closed / K.master.total) * 100));
const OPEN = String(K.master.total - K.master.closed);

/** The six tiles in band order, each with the catalogue key of its statement line. */
const TILES = [
  ['master', 'master'],
  ['claims', 'specClaims'],
  ['specs', 'specs'],
  ['takeable', 'takeable'],
  ['warnings', 'warnings'],
  ['fog', 'fog'],
] as const;

type Catalogue = { kpi: { statement: Record<string, string>; of: string }; specs: { count: { other: string } } };
const catalogue = (lang: Lang) => CATALOGUES[lang] as unknown as Catalogue;
/** The direction a statement line must name in words, per language. */
const DIRECTION: Record<Lang, RegExp> = { en: /(more|fewer) is better/, de: /(mehr|weniger) ist besser/ };
/** "n of N specs" as the catalogue words it. */
const ofSpecs = (lang: Lang, n: number) =>
  `${String(n)} ${catalogue(lang).kpi.of.replace('{{total}}', catalogue(lang).specs.count.other.replace('{{count}}', String(K.specs)))}`;

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
    const cell = (name: string) => pulse?.querySelector<HTMLAnchorElement>(`.cells [data-cell="${name}"]`);
    return { fixture, host, tile, text, card, pulse, cell, squash };
  }

  describe('kpi-band: six tiles, each with a reference and a statement line (spec 021, ISC-245)', () => {
    it('kpi-band: shows six tiles in band order, Warnings and Open fog apart, no Attention and no Archive tile', async () => {
      const { host } = await render();
      expect([...host.querySelectorAll('.band > [data-kpi]')].map((node) => node.getAttribute('data-kpi'))).toEqual(TILES.map(([kpi]) => kpi));
      expect(host.querySelector('[data-kpi="attention"], [data-stat="attention"]')).toBeNull();
      expect(host.querySelector('[data-kpi="archive"], [data-stat="archive"]')).toBeNull();
    });

    it('kpi-band: every tile shows its number with a reference from the model, a fraction or "n of N specs"', async () => {
      const { text } = await render();
      const figure = (kpi: string) => text(kpi, '.figure')?.replace(/ /g, '');

      expect(figure('master')).toBe(MASTER);
      expect(figure('claims')).toBe(CLAIMS);
      expect(figure('specs')).toBe(`${String(K.stageGroups.complete)}/${String(K.specs)}`);
      expect(figure('takeable')).toBe(`${String(K.takeable)}/${String(K.openClaims)}`);
      expect(figure('warnings')).toBe(String(K.warnings));
      expect(text('warnings', '.meta')).toBe(ofSpecs('en', K.specsWithWarnings));
      expect(figure('fog')).toBe(String(K.fog));
      expect(text('fog', '.meta')).toBe(ofSpecs('en', K.specsWithFog));
    });

    it('kpi-band: Warnings and Open fog are two numbers from their own fields, never their sum', async () => {
      const model: KpiBandModel = { kpis: { ...HARBOR.kpis, warnings: 3, fog: 0, specsWithWarnings: 2, specsWithFog: 0 } };
      const { host, text, cell, squash } = await render(model);

      expect(text('warnings', '.value')).toBe('3');
      expect(text('fog', '.value')).toBe('0');
      expect(text('fog', '.meta')).toBe(ofSpecs('en', 0));
      expect(squash(cell('warnings')?.querySelector('b'))).toBe('3');
      expect(squash(cell('fog')?.querySelector('b'))).toBe('0');
      expect(squash(host)).not.toContain('Attention');
    });

    it('kpi-band: the Specs tile reads the stage groups the model counts, no split computed in the web', async () => {
      // Groups that disagree with `specs - building - scoping`: the band must show the model's numbers.
      const model: KpiBandModel = { kpis: { ...HARBOR.kpis, stageGroups: { scoping: 2, building: 1, complete: 5 } } };
      const { tile, text, squash } = await render(model);
      const legend = [...(tile('specs')?.querySelectorAll('.legend .entry') ?? [])].map((entry) => squash(entry));

      expect(text('specs', '.figure')?.replace(/ /g, '')).toBe(`5/${String(K.specs)}`);
      expect(legend).toEqual(['building 1', 'scoping 2', 'complete 5']);
    });

    for (const lang of LANGS) {
      it(`kpi-band: every tile and every compact cell carries its statement line, naming the good direction (${lang})`, async () => {
        const { fixture, host, tile, pulse, cell, squash } = await render();
        TestBed.inject(TranslocoService).setActiveLang(lang);
        await fixture.whenStable();
        const words = catalogue(lang).kpi.statement;

        for (const [kpi, key] of TILES) {
          expect(words[key], `${lang} kpi.statement.${key}`).toMatch(DIRECTION[lang]);
          expect(squash(tile(kpi)?.querySelector('.statement')), kpi).toBe(words[key]);
        }
        expect(squash(pulse?.querySelector('.top .statement'))).toBe(words['master']);
        expect(squash(pulse?.querySelector('.claims .statement'))).toBe(words['specClaims']);
        for (const [name, key] of TILES.slice(2)) expect(squash(cell(name)?.querySelector('.statement')), name).toBe(words[key]);
        expect(host.getAttribute('lang')).toBe(lang);
      });

      it(`kpi-band: every key the band reads stands in the ${lang} catalogue`, () => {
        const words = catalogue(lang).kpi;
        for (const [, key] of TILES) expect(words.statement[key], key).toBeTruthy();
        expect(words.of).toContain('{{total}}');
      });
    }

    it('kpi-band: the compact form is the master row over a 2 × 2 grid, each cell with its reference', async () => {
      const { pulse, cell, squash } = await render();
      const cells = [...(pulse?.querySelectorAll<HTMLAnchorElement>('.cells a') ?? [])];

      expect(cells.map((link) => link.getAttribute('data-cell'))).toEqual(['specs', 'takeable', 'warnings', 'fog']);
      expect(squash(cell('specs')?.querySelector('b'))?.replace(/ /g, '')).toBe(`${String(K.stageGroups.complete)}/${String(K.specs)}`);
      expect(squash(cell('takeable')?.querySelector('b'))?.replace(/ /g, '')).toBe(`${String(K.takeable)}/${String(K.openClaims)}`);
      expect(squash(cell('warnings')?.querySelector('.ref'))).toBe(ofSpecs('en', K.specsWithWarnings));
      expect(squash(cell('fog')?.querySelector('.ref'))).toBe(ofSpecs('en', K.specsWithFog));
      expect(cells.map((link) => link.getAttribute('href'))).toEqual([
        '/w/harbor#specs',
        '/w/harbor?sort=next&takeable=1#specs',
        '/w/harbor#warnings',
        '/w/harbor?phase=fog#specs',
      ]);
    });

    it('kpi-band: follows the shell tier, so the band or the Pulse card stands', async () => {
      const { fixture, host } = await render();
      expect(host.getAttribute('data-tier')).toBe('wide');
      TestBed.inject(ShellState).tier.set('compact');
      await fixture.whenStable();
      expect(host.getAttribute('data-tier')).toBe('compact');
    });

    it('kpi-band: a reference the model does not carry yet shows a dash, never a computed number', async () => {
      const { text } = await render(BARE);
      expect(text('takeable', '.figure')?.replace(/ /g, '')).toBe(`${String(K.takeable)}/—`);
      expect(text('specs', '.figure')?.replace(/ /g, '')).toBe(`—/${String(K.specs)}`);
      expect(text('warnings', '.meta')).toBe(ofSpecs('en', K.specsWithWarnings).replace(String(K.specsWithWarnings), '—'));
    });
  });

  it('renders the master tile as it is: fraction, percent caption and ring', async () => {
    const { text } = await render();

    expect(text('master', '.figure')?.replace(/ /g, '')).toBe(MASTER);
    expect(text('master', '.meta')).toBe(`${PCT} % closed · ${OPEN} open`);
    expect(text('master', 'ui-ring .text')?.replace(/ /g, '')).toBe(`${PCT}%`);
  });

  it('ports the prototype tiles: hero ring 112, lime claims meter, "Takeable now", no reserved slot', async () => {
    const { host, tile, text } = await render();
    const claimsMeter = tile('claims')?.querySelector('ui-meter');

    expect(tile('master')?.querySelector('ui-ring')?.getAttribute('data-size')).toBe('112');
    expect(claimsMeter?.getAttribute('aria-valuenow')).toBe(String(K.claims.closed));
    expect(claimsMeter?.querySelector('.fill')?.getAttribute('style')).toContain('--color-accent');
    expect(text('takeable', '.eyebrow-text')).toBe('Takeable now');
    expect(host.querySelector('[data-kpi="activity"]')).toBeNull();
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
    expect(look('warnings')).toEqual({ edge: true, glow: true, tone: 'warning' });
    expect(look('fog')).toEqual({ edge: true, glow: true, tone: 'secondary' });
  });

  it('makes every tile with a destination one link on /w/:ws, its target as query state and fragment', async () => {
    const { tile } = await render();
    const href = (kpi: string) => tile(kpi)?.querySelector('a.tile')?.getAttribute('href') ?? null;

    expect(href('specs')).toBe('/w/harbor#specs');
    expect(href('takeable')).toBe('/w/harbor?sort=next&takeable=1#specs');
    expect(href('warnings')).toBe('/w/harbor#warnings');
    expect(href('fog')).toBe('/w/harbor?phase=fog#specs');
    expect(href('master')).toBeNull();
    expect(href('claims')).toBeNull();
  });

  it('carries the Pulse card for the compact form: ring 72, master fraction, spec-claims meter on one line', async () => {
    const { pulse, squash } = await render();

    expect(pulse?.querySelector('ui-card')?.hasAttribute('data-glow')).toBe(true);
    expect(pulse?.querySelector('ui-card')?.hasAttribute('data-edge')).toBe(false);
    expect(pulse?.querySelector('ui-ring')?.getAttribute('data-size')).toBe('72');
    expect(squash(pulse?.querySelector('.figure'))?.replace(/ /g, '')).toBe(MASTER);
    expect(squash(pulse?.querySelector('.claims-row .type-eyebrow'))).toBe('Spec claims');
    expect(squash(pulse?.querySelector('.claims-row .frac'))).toBe(CLAIMS);
    expect(pulse?.querySelector('.claims-row ui-meter')?.getAttribute('aria-valuenow')).toBe(String(K.claims.closed));
  });

  it('shows a dash for a workspace without a master and keeps the tile calm', async () => {
    const empty: KpiBandModel = {
      kpis: { ...HARBOR.kpis, master: null, specs: 0, stageGroups: { scoping: 0, building: 0, complete: 0 }, takeable: 0, warnings: 0, fog: 0 },
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
    expect(text('master', '.meta')).toBe(`${PCT} % geschlossen · ${OPEN} offen`);
    expect(text('warnings', '.meta')).toBe(ofSpecs('de', K.specsWithWarnings));
  });

  describe('changed-value tint (design.md § Live update, ISC-62.1)', () => {
    const tinted = (host: HTMLElement) =>
      [...host.querySelectorAll<HTMLElement>('[data-tint]')].map((node) => `${node.dataset['kpi'] ?? node.dataset['stat'] ?? '?'}:${node.dataset['tint'] ?? ''}`);

    it('tints nothing before a refresh changed a value', async () => {
      const { host } = await render();
      expect(tinted(host)).toEqual([]);
    });

    it('maps each changed KPI path to its tile, in the band and in the Pulse card', async () => {
      const { fixture, host } = await render();
      fixture.componentRef.setInput('changed', new Set(['claims.closed', 'fog', 'master.total', 'specsWithWarnings', 'stageGroups.complete']));
      await fixture.whenStable();
      expect(tinted(host)).toEqual([
        'master:a',
        'claims:a',
        'specs:a',
        'warnings:a',
        'fog:a',
        'master:a',
        'claims:a',
        'specs:a',
        'warnings:a',
        'fog:a',
      ]);
    });

    it('restarts the tint on the next refresh that changes the same value, and drops it on one that changes nothing', async () => {
      const { fixture, host } = await render();
      fixture.componentRef.setInput('changed', new Set(['claims.closed']));
      await fixture.whenStable();
      expect(tinted(host)).toEqual(['claims:a', 'claims:a']);

      fixture.componentRef.setInput('changed', new Set(['claims.closed']));
      await fixture.whenStable();
      expect(tinted(host)).toEqual(['claims:b', 'claims:b']);

      fixture.componentRef.setInput('changed', new Set());
      await fixture.whenStable();
      expect(tinted(host)).toEqual([]);
    });
  });
});
