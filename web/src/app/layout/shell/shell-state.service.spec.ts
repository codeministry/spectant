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

const routes: Routes = [
  { path: 'w/:ws', component: Stub },
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
  });
});
