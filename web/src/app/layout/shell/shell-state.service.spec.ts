import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, type Routes } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { type ShellRouteData, switchSpecLink } from './areas';
import { type ShellRoute, ShellState, stepSpec } from './shell-state.service';

@Component({ selector: 'app-stub', template: '' })
class Stub {}

const notFound: ShellRouteData = { notFound: true };
const milestones: ShellRouteData = { page: 'milestones' };

const board: ShellRouteData = { page: 'board' };
const idea: ShellRouteData = { page: 'idea' };

// The board and story routes as T115 registers them in `app.routes.ts`; declared here so the derivation is pinned first.
const routes: Routes = [
  { path: 'w/:ws', component: Stub },
  { path: 'w/:ws/board', component: Stub, data: board },
  { path: 'w/:ws/ideas/:slug', component: Stub, data: idea },
  { path: 'w/:ws/milestones', component: Stub, data: milestones },
  { path: 'w/:ws/s/:id', component: Stub },
  { path: '**', component: Stub, data: notFound },
];

async function routeAt(url: string): Promise<ShellRoute> {
  TestBed.configureTestingModule({ providers: [provideRouter(routes), provideHttpClient(), provideHttpClientTesting()] });
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(url);
  return TestBed.inject(ShellState).route();
}

describe('ShellState.route().wsPage', () => {
  it("is 'specs' on the workspace route", async () => {
    expect((await routeAt('/w/harbor')).wsPage).toBe('specs');
  });

  it('is null on a spec route', async () => {
    expect((await routeAt('/w/harbor/s/002')).wsPage).toBeNull();
  });

  it('is null on a not-found route', async () => {
    expect((await routeAt('/nope')).wsPage).toBeNull();
  });

  it('is the page a route declares in its data', async () => {
    const route = await routeAt('/w/harbor/milestones');
    expect(route.wsPage).toBe('milestones');
    expect(route.ws).toBe('harbor');
    expect(route.specId).toBeNull();
    expect(route.ideaSlug).toBeNull();
  });

  it("is 'board' on the workspace board, with no spec and no story (spec 008, ISC-129)", async () => {
    const route = await routeAt('/w/harbor/board?feature=F1&col=build');
    expect(route).toEqual({ ws: 'harbor', specId: null, area: null, tab: null, lens: null, wsPage: 'board', ideaSlug: null, notFound: false });
  });

  it("is 'idea' on a story page, with the story's slug from the URL", async () => {
    const route = await routeAt('/w/harbor/ideas/tide-tables');
    expect(route).toEqual({ ws: 'harbor', specId: null, area: null, tab: null, lens: null, wsPage: 'idea', ideaSlug: 'tide-tables', notFound: false });
  });

  it('decodes an encoded story slug once, as the router does', async () => {
    expect((await routeAt('/w/harbor/ideas/tide%20tables')).ideaSlug).toBe('tide tables');
  });

  it('has no story slug on the workspace and spec routes', async () => {
    expect((await routeAt('/w/harbor')).ideaSlug).toBeNull();
    TestBed.resetTestingModule();
    expect((await routeAt('/w/harbor/s/002')).ideaSlug).toBeNull();
  });
});

describe('ShellState.lastWs (spec 008, T129)', () => {
  it('keeps the workspace of the last /w/:ws route after leaving it for a global page', async () => {
    TestBed.configureTestingModule({ providers: [provideRouter(routes), provideHttpClient(), provideHttpClientTesting()] });
    const state = TestBed.inject(ShellState);
    const harness = await RouterTestingHarness.create();
    expect(state.lastWs()).toBeNull();
    await harness.navigateByUrl('/w/harbor/s/002');
    await harness.navigateByUrl('/help');
    expect(state.ws()).toBeNull();
    expect(state.lastWs()).toBe('harbor');
    await harness.navigateByUrl('/w/lantern');
    expect(state.lastWs()).toBe('lantern');
  });
});

describe('stepSpec (spec 052, T27, ISC-331)', () => {
  const order = ['001', '002', '003', '004', '005'];

  it('without favourites steps through the whole order, as before', () => {
    expect(stepSpec(order, [], '002', 1)).toBe('003');
    expect(stepSpec(order, [], '002', -1)).toBe('001');
    expect(stepSpec(order, [], '005', 1)).toBeUndefined();
    expect(stepSpec(order, [], '001', -1)).toBeUndefined();
  });

  it('from a favourite goes to the next / previous favourite in list order', () => {
    expect(stepSpec(order, ['002', '004'], '002', 1)).toBe('004');
    expect(stepSpec(order, ['002', '004'], '004', -1)).toBe('002');
  });

  it('from a spec without a star goes to the nearest favourite in that direction', () => {
    expect(stepSpec(order, ['002', '004'], '003', 1)).toBe('004');
    expect(stepSpec(order, ['002', '004'], '003', -1)).toBe('002');
    expect(stepSpec(order, ['002', '004'], '005', -1)).toBe('004');
    expect(stepSpec(order, ['002', '004'], '001', 1)).toBe('002');
  });

  it('does not wrap: no favourite beyond the end in that direction is no step', () => {
    expect(stepSpec(order, ['002', '004'], '004', 1)).toBeUndefined();
    expect(stepSpec(order, ['002', '004'], '002', -1)).toBeUndefined();
    expect(stepSpec(order, ['002', '004'], '005', 1)).toBeUndefined();
  });

  it('a spec outside the order is no step, with or without favourites', () => {
    expect(stepSpec(order, ['002', '004'], '009', 1)).toBeUndefined();
    expect(stepSpec(order, [], '009', -1)).toBeUndefined();
  });
});

describe('ShellState.handleKey [ and ] with favourites (spec 052, T27, ISC-331)', () => {
  const claims = { tab: 'claims' } as ShellRouteData;
  const tabRoutes: Routes = [{ path: 'w/:ws/s/:id/claims', component: Stub, data: claims }, ...routes];
  const order = ['001', '002', '003', '004', '005'];

  async function at(url: string) {
    TestBed.configureTestingModule({ providers: [provideRouter(tabRoutes), provideHttpClient(), provideHttpClientTesting()] });
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const state = TestBed.inject(ShellState);
    const press = (key: string, favorites: readonly string[]): boolean =>
      state.handleKey(new KeyboardEvent('keydown', { key, cancelable: true }), order, favorites);
    return { navigate, press };
  }

  it('] and [ from a favourite go to the next / previous favourite on the same tab', async () => {
    const { navigate, press } = await at('/w/harbor/s/002/claims');
    expect(press(']', ['002', '004'])).toBe(true);
    expect(navigate).toHaveBeenLastCalledWith(switchSpecLink('harbor', '004', 'claims'));
    expect(press('[', ['002', '004'])).toBe(false);
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('] and [ from a spec without a star go to the nearest favourite on the same tab', async () => {
    const { navigate, press } = await at('/w/harbor/s/003/claims');
    press(']', ['002', '005']);
    expect(navigate).toHaveBeenLastCalledWith(switchSpecLink('harbor', '005', 'claims'));
    press('[', ['002', '005']);
    expect(navigate).toHaveBeenLastCalledWith(switchSpecLink('harbor', '002', 'claims'));
  });

  it('without favourites ] and [ still step through every open spec', async () => {
    const { navigate, press } = await at('/w/harbor/s/003/claims');
    press(']', []);
    expect(navigate).toHaveBeenLastCalledWith(switchSpecLink('harbor', '004', 'claims'));
    press('[', []);
    expect(navigate).toHaveBeenLastCalledWith(switchSpecLink('harbor', '002', 'claims'));
  });
});
