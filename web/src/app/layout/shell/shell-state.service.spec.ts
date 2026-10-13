import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, type Routes } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { ShellRouteData } from './areas';
import { type ShellRoute, ShellState } from './shell-state.service';

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
    expect(route).toEqual({ ws: 'harbor', specId: null, area: null, tab: null, wsPage: 'board', ideaSlug: null, notFound: false });
  });

  it("is 'idea' on a story page, with the story's slug from the URL", async () => {
    const route = await routeAt('/w/harbor/ideas/tide-tables');
    expect(route).toEqual({ ws: 'harbor', specId: null, area: null, tab: null, wsPage: 'idea', ideaSlug: 'tide-tables', notFound: false });
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
