import { TestBed } from '@angular/core/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { CATALOGUES, LANGS } from '../../../i18n/catalogues';
import type { StripKpis } from './overview-model';
import { TileKpis } from './tile-kpis';

/** Stands in for the browser's ResizeObserver: the test decides when the tile's width changed. */
class FakeResizeObserver {
  static all: FakeResizeObserver[] = [];
  readonly targets: Element[] = [];
  constructor(private readonly callback: ResizeObserverCallback) {
    FakeResizeObserver.all.push(this);
  }
  observe(target: Element): void {
    this.targets.push(target);
  }
  unobserve(): void {
    // Nothing to release.
  }
  disconnect(): void {
    this.targets.length = 0;
  }
  fire(): void {
    this.callback(this.targets.map((target) => ({ target }) as ResizeObserverEntry), this);
  }
}

const KPIS: StripKpis = {
  master: { closed: 3, total: 4 },
  claims: { closed: 650, total: 656 },
  specs: 7,
  building: 2,
  scoping: 1,
  warnings: 2,
  fog: 5,
};

function render(kpis: StripKpis, lang = 'en'): { host: HTMLElement; detect: () => void } {
  TestBed.configureTestingModule({
    imports: [
      TranslocoTestingModule.forRoot({
        langs: CATALOGUES,
        translocoConfig: { availableLangs: [...LANGS], defaultLang: lang },
        preloadLangs: true,
      }),
    ],
  });
  const fixture = TestBed.createComponent(TileKpis);
  fixture.componentRef.setInput('kpis', kpis);
  fixture.detectChanges();
  return {
    host: fixture.nativeElement as HTMLElement,
    detect: () => {
      fixture.detectChanges();
    },
  };
}

const cell = (host: HTMLElement, name: string): HTMLElement => {
  const found = host.querySelector<HTMLElement>(`[data-kpi="${name}"]`);
  if (found === null) throw new Error(`no [data-kpi="${name}"]`);
  return found;
};
const text = (el: Element | null): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('TileKpis (spec 066 T11, ISC-520)', () => {
  beforeEach(() => {
    FakeResizeObserver.all = [];
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the four cells in order, without cards, rings or glow', () => {
    const { host } = render(KPIS);
    const names = [...host.querySelectorAll('[data-kpi]')].map((el) => el.getAttribute('data-kpi'));
    expect(names).toEqual(['master', 'claims', 'specs', 'warnings']);
    expect(host.querySelector('ui-card')).toBeNull();
    expect(host.querySelector('ui-ring')).toBeNull();
    for (const name of names) {
      const el = cell(host, name ?? '');
      expect(el.querySelector('.type-eyebrow')?.getAttribute('title')).toBeTruthy();
      expect(el.querySelectorAll('ui-meter[data-mini]')).toHaveLength(1);
    }
  });

  it('shows master as a 4 px bar with closed/total instead of the ring', () => {
    const { host } = render(KPIS);
    const master = cell(host, 'master');
    expect(text(master.querySelector('.val'))).toBe('3/4');
    expect(text(master.querySelector('.val small'))).toBe('/4');
    const bar = master.querySelector('ui-meter');
    expect(bar?.getAttribute('aria-valuenow')).toBe('3');
    expect(bar?.getAttribute('aria-valuemax')).toBe('4');
  });

  it('shows the no-value sign and an empty bar without a master', () => {
    const { host } = render({ ...KPIS, master: null });
    const master = cell(host, 'master');
    expect(text(master.querySelector('.val'))).toBe('—');
    expect(master.querySelector('ui-meter')?.getAttribute('aria-valuenow')).toBe('0');
  });

  it('keeps the claims meter and the specs split as bars', () => {
    const { host } = render(KPIS);
    expect(text(cell(host, 'claims').querySelector('.val'))).toBe('650/656');
    expect(cell(host, 'claims').querySelector('ui-meter')?.getAttribute('aria-valuenow')).toBe('650');
    expect(text(cell(host, 'specs').querySelector('.val'))).toBe('7');
    expect(cell(host, 'specs').querySelectorAll('ui-meter .seg')).toHaveLength(2);
  });

  it('gives the specs cell an empty track when no spec builds or scopes', () => {
    const { host } = render({ ...KPIS, building: 0, scoping: 0 });
    const bar = cell(host, 'specs').querySelector('ui-meter');
    expect(bar?.hasAttribute('data-split')).toBe(false);
    expect(bar?.getAttribute('aria-valuenow')).toBe('0');
  });

  it('marks warnings above 0 in warn ink with a warning bar and "· n fog" after the value', () => {
    const { host } = render(KPIS);
    const warnings = cell(host, 'warnings');
    expect(warnings.hasAttribute('data-warn')).toBe(true);
    expect(text(warnings.querySelector('.val'))).toBe('2 · 5 fog');
    expect(text(warnings.querySelector('.fog'))).toBe('· 5 fog');
    const fill = warnings.querySelector<HTMLElement>('ui-meter .fill');
    expect(fill?.style.background).toContain('--color-warning');
    expect(warnings.querySelector('ui-meter')?.getAttribute('aria-valuenow')).toBe('1');
  });

  it('leaves warnings at 0 on the bare track, without warn ink', () => {
    const { host } = render({ ...KPIS, warnings: 0, fog: 0 });
    const warnings = cell(host, 'warnings');
    expect(warnings.hasAttribute('data-warn')).toBe(false);
    expect(warnings.querySelector('ui-meter')?.getAttribute('aria-valuenow')).toBe('0');
  });

  it('writes the fog suffix in German', () => {
    const { host } = render(KPIS, 'de');
    expect(text(cell(host, 'warnings').querySelector('.fog'))).toBe('· 5 Fog');
  });

  it('reflects the container query in data-layout: grid by default, row once the tile is wide', () => {
    const { host, detect } = render(KPIS);
    expect(host.getAttribute('data-layout')).toBe('grid');
    const observer = FakeResizeObserver.all.find((o) => o.targets.includes(host));
    expect(observer).toBeDefined();
    host.style.setProperty('--tile-kpi-layout', 'row');
    observer?.fire();
    detect();
    expect(host.getAttribute('data-layout')).toBe('row');
    host.style.setProperty('--tile-kpi-layout', 'grid');
    observer?.fire();
    detect();
    expect(host.getAttribute('data-layout')).toBe('grid');
  });
});
