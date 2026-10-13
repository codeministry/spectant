import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { routes } from '../../app.routes';
import { ApiClient, type ApiResult } from '../../core/api.service';
import { ShellState } from '../shell/shell-state.service';
import { TabBarSlot } from './tab-bar-slot';

// Spec 023: the slot renders no tech tabs over the not-found page, on the same condition the tech page uses
// (`ShellData.techMissing`: the workspace or the tech route answered the contract's 404).

const STUB = {
  en: {
    shell: { tabBar: '{{area}} tabs', pages: { tech: 'Tech' } },
    tech: { tabs: { overview: 'Overview', architecture: 'Architecture', status: 'Status', specs: 'Specs', open: 'Open' } },
  },
};

const NOT_SERVED = { kind: 'not-found', served: false } as const;
const MISSING = { kind: 'not-found', served: true } as const;
const ok = <T>(body: T): ApiResult<T> => ({ kind: 'ok', body, etag: null, notModified: false });

@Component({
  selector: 'app-slot-host',
  imports: [TabBarSlot],
  template: `<header></header><main><app-tab-bar-slot /></main>`,
})
class SlotHost {}

/** `nope` is an unknown workspace (dashboard and tech answer the served 404); `bare` has no tech route answer. */
async function at(url: string): Promise<HTMLElement> {
  const answers: Record<string, unknown> = {
    dashboard: (ws: string) => Promise.resolve(ws === 'nope' ? MISSING : ok({ specs: [], archive: [] })),
    tech: (ws: string) => Promise.resolve(ws === 'nope' || ws === 'bare' ? MISSING : ok({ pages: null, specs: [] })),
  };
  const api = new Proxy({}, { get: (_, key: string) => answers[key] ?? (() => Promise.resolve(NOT_SERVED)) });
  TestBed.configureTestingModule({
    imports: [TranslocoTestingModule.forRoot({ langs: STUB, translocoConfig: { availableLangs: ['en'], defaultLang: 'en' }, preloadLangs: true })],
    providers: [provideRouter(routes), provideHttpClient(), provideHttpClientTesting(), { provide: ApiClient, useValue: api }],
  });
  await TestBed.inject(Router).navigateByUrl(url);
  TestBed.inject(ShellState).tier.set('compact');
  const fixture = TestBed.createComponent(SlotHost);
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('TabBarSlot over the tech not-found page (spec 023)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('renders the tech tabs at compact for a known workspace', async () => {
    const root = await at('/w/harbor/tech/overview');
    expect(root.querySelectorAll('main app-tab-bar')).toHaveLength(1);
  });

  it('renders no bar at compact when the workspace is unknown', async () => {
    const root = await at('/w/nope/tech/overview');
    expect(root.querySelector('app-tab-bar')).toBeNull();
  });

  it('renders no bar when the tech route answers the contract\'s 404', async () => {
    const root = await at('/w/bare/tech/status');
    expect(root.querySelector('app-tab-bar')).toBeNull();
  });
});
