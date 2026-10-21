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
const PCT = String(K.masterPercent);
const OPEN = String(K.masterOpen);

/** The six tiles in band order, each with the catalogue key of its statement line. */
const TILES = [
  ['master', 'master'],
  ['claims', 'specClaims'],
  ['specs', 'specs'],
  ['takeable', 'takeable'],
  ['warnings', 'warnings'],
  ['fog', 'fog'],
] as const;

type Catalogue = {
  kpi: { statement: Record<string, string>; closedOpen: string; inSpecs: { one: string; other: string } };
};
const catalogue = (lang: Lang) => CATALOGUES[lang] as unknown as Catalogue;
/** The direction a statement line must name in words, per language. */
const DIRECTION: Record<Lang, RegExp> = { en: /(more|fewer) is better/, de: /(mehr|weniger) ist besser/ };
/** "in n of N specs" as the catalogue words it; `n` a number or the dash. */
const ofSpecs = (lang: Lang, n: number | string) =>
  catalogue(lang).kpi.inSpecs.other.replace('{{count}}', String(n)).replace('{{total}}', String(K.specs));
/** "c closed · o open" as the catalogue words it. */
const closedOpen = (lang: Lang, closed: number | string, open: number | string) =>
  catalogue(lang).kpi.closedOpen.replace('{{closed}}', String(closed)).replace('{{open}}', String(open));

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
      const { fixture, tile, text, squash } = await render(model);
      // The legend stands below wide only (P3 heights); at medium it names the model's counts.
      TestBed.inject(ShellState).tier.set('medium');
      await fixture.whenStable();
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
        for (const form of ['one', 'other'] as const) {
          expect(words.inSpecs[form], `inSpecs.${form}`).toContain('{{count}}');
          expect(words.inSpecs[form], `inSpecs.${form}`).toContain('{{total}}');
        }
        expect(words.closedOpen).not.toContain('%');
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
        '/w/harbor/specs',
        '/w/harbor/specs?sort=next&takeable=1',
        '/w/harbor?open=warnings#warnings',
        '/w/harbor/specs?phase=fog',
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
      expect(text('warnings', '.meta')).toBe(ofSpecs('en', '—'));
    });
  });

  describe('kpi-band master: the master tile names its percent once (spec 021, ISC-245.1)', () => {
    // 308 of 400 closed: 77 %, and neither the fraction nor the open count contains "77".
    const AT_77: KpiBandModel = { kpis: { ...HARBOR.kpis, master: { closed: 308, total: 400 }, masterOpen: 92, masterPercent: 77 } };
    const percents = (node: Element | null | undefined) => node?.textContent.match(/\d+\s*%/g) ?? [];

    for (const lang of LANGS) {
      it(`kpi-band master: the ring carries the percent, the line below reads closed and open without it, every tier (${lang})`, async () => {
        const { fixture, tile, pulse, squash } = await render(AT_77);
        TestBed.inject(TranslocoService).setActiveLang(lang);
        const meta = closedOpen(lang, 308, 92);

        for (const tier of ['wide', 'medium', 'compact'] as const) {
          TestBed.inject(ShellState).tier.set(tier);
          await fixture.whenStable();
          const top = pulse?.querySelector('.top');

          expect(percents(tile('master')), `${tier} band tile`).toEqual(['77%']);
          expect(percents(tile('master')?.querySelector('ui-ring')), `${tier} band ring`).toEqual(['77%']);
          expect(squash(tile('master')?.querySelector('.meta')), `${tier} band meta`).toBe(meta);
          expect(percents(top), `${tier} pulse row`).toEqual(['77%']);
          expect(percents(top?.querySelector('ui-ring')), `${tier} pulse ring`).toEqual(['77%']);
          expect(squash(top?.querySelector('.ref')), `${tier} pulse meta`).toBe(meta);
        }
      });
    }
  });

  it('kpi-band master: the open count and the ring percent are the served fields, never computed (ISC-255)', async () => {
    // Served values that no arithmetic over closed and total gives: the band must show these, not 92 and 77.
    const served: KpiBandModel = { kpis: { ...HARBOR.kpis, master: { closed: 308, total: 400 }, masterOpen: 5, masterPercent: 13 } };
    const { text, pulse, squash } = await render(served);

    expect(text('master', '.meta')).toBe(closedOpen('en', 308, 5));
    expect(text('master', 'ui-ring .text')?.replace(/ /g, '')).toBe('13%');
    expect(squash(pulse?.querySelector('.top ui-ring'))?.replace(/ /g, '')).toBe('13%');
  });

  it('kpi-band master: without the served percent the ring shows a dash', async () => {
    const { text } = await render({ kpis: { ...HARBOR.kpis, masterOpen: undefined, masterPercent: undefined } });

    expect(text('master', 'ui-ring .text')).toBe('—');
  });

  it('renders the master tile as it is: fraction, closed and open caption, and the ring with the percent', async () => {
    const { text } = await render();

    expect(text('master', '.figure')?.replace(/ /g, '')).toBe(MASTER);
    expect(text('master', '.meta')).toBe(closedOpen('en', K.master.closed, OPEN));
    expect(text('master', 'ui-ring .text')?.replace(/ /g, '')).toBe(`${PCT}%`);
  });

  describe('kpi-band heights: the one-row band at wide and the Pulse card at compact (spec 021, ISC-246.1, P3)', () => {
    it('kpi-band heights: at wide the master tile is a 16 px tile with an 88 px ring; at medium the 112 px hero', async () => {
      const { fixture, tile } = await render();
      const look = () => ({
        variant: tile('master')?.getAttribute('data-variant'),
        padding: tile('master')?.querySelector<HTMLElement>('ui-card')?.style.padding,
        ring: tile('master')?.querySelector('ui-ring')?.getAttribute('data-size'),
      });

      expect(look()).toEqual({ variant: 'default', padding: '16px', ring: '88' });
      TestBed.inject(ShellState).tier.set('medium');
      await fixture.whenStable();
      expect(look()).toEqual({ variant: 'hero', padding: '24px', ring: '112' });
    });

    it('kpi-band heights: the Specs tile drops its phase legend at wide and keeps the labelled split meter', async () => {
      const { fixture, tile } = await render();
      const meter = () => tile('specs')?.querySelector('ui-meter');

      expect(tile('specs')?.querySelector('.legend')).toBeNull();
      expect(meter()?.getAttribute('aria-label')).toBe('Specs');
      for (const tier of ['medium', 'compact'] as const) {
        TestBed.inject(ShellState).tier.set(tier);
        await fixture.whenStable();
        expect(tile('specs')?.querySelectorAll('.legend .entry').length, tier).toBe(3);
      }
    });

    it('kpi-band heights: in the Pulse card the eyebrow and the number share a line, reference and statement one text below', async () => {
      const { pulse, cell, squash } = await render();
      const head = pulse?.querySelector('.top .lead > .head');
      const say = pulse?.querySelector('.top .lead > .say');

      expect([...(head?.children ?? [])].map((node) => node.className.split(' ')[0])).toEqual(['type-eyebrow', 'figure']);
      expect([...(say?.children ?? [])].map((node) => node.className)).toEqual(['ref', 'statement']);
      for (const name of ['specs', 'takeable', 'warnings', 'fog']) {
        const link = cell(name);
        expect([...(link?.children ?? [])].map((node) => node.className), name).toEqual(['head', 'say']);
        expect(link?.querySelector('.head > .type-eyebrow + b'), name).not.toBeNull();
        expect(link?.querySelector('.say > .statement'), name).not.toBeNull();
      }
      expect(squash(cell('warnings')?.querySelector('.say > .ref'))).toBe(ofSpecs('en', K.specsWithWarnings));
      expect(squash(cell('fog')?.querySelector('.say > .ref'))).toBe(ofSpecs('en', K.specsWithFog));
    });
  });

  it('ports the prototype tiles: hero ring 112 below wide, lime claims meter, "Takeable now", no reserved slot', async () => {
    const { fixture, host, tile, text } = await render();
    const claimsMeter = tile('claims')?.querySelector('ui-meter');
    TestBed.inject(ShellState).tier.set('medium');
    await fixture.whenStable();

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

  it('links the list tiles to /w/:ws/specs with their query state and Warnings to ?open=warnings#warnings on /w/:ws (ISC-395, ISC-475)', async () => {
    const { tile } = await render();
    const href = (kpi: string) => tile(kpi)?.querySelector('a.tile')?.getAttribute('href') ?? null;

    expect(href('specs')).toBe('/w/harbor/specs');
    expect(href('takeable')).toBe('/w/harbor/specs?sort=next&takeable=1');
    expect(href('warnings')).toBe('/w/harbor?open=warnings#warnings');
    expect(href('fog')).toBe('/w/harbor/specs?phase=fog');
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
      kpis: { ...HARBOR.kpis, master: null, masterOpen: null, masterPercent: null, specs: 0, stageGroups: { scoping: 0, building: 0, complete: 0 }, takeable: 0, warnings: 0, fog: 0 },
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
    expect(text('master', '.meta')).toBe(`${String(K.master.closed)} geschlossen · ${OPEN} offen`);
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
