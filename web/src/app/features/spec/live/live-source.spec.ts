import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { TranslocoTestingModule } from '@jsverse/transloco';
import frames from '../../../../../../core/fixtures/harbor.frames.golden.json';
import live from '../../../../../../core/fixtures/harbor.live.golden.json';
import type { Frame, LiveFrame } from '../../../../../../core/src/files';
import { ApiClient } from '../../../core/api.service';
import { RefreshService } from '../../../core/refresh.service';
import { SETTINGS_URL, SettingsService } from '../../../core/settings.service';
import { ShellData } from '../../../layout/shell/shell-data.service';
import { ShellState } from '../../../layout/shell/shell-state.service';
import { CATALOGUES, LANGS } from '../../../../i18n/catalogues';
import { BoardTab } from './board/board-tab';
import { MatrixTab } from './matrix/matrix-tab';

// Spec 057 · T20 · ISC-371 (review 024): the board, an open card detail and the matrix beside them share one read of
// `…/live` per refresh tick, never one read each.

const KEY = 'specs/002-web-console';
const HISTORY = (frames as unknown as Record<string, Frame[]>)[KEY] ?? [];
const LIVE = (live as unknown as Record<string, LiveFrame>)[KEY];

@Component({
  selector: 'app-live-pair',
  imports: [BoardTab, MatrixTab],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<app-board-tab /><app-matrix-tab />',
})
class LivePair {}

async function settle(fixture: ComponentFixture<LivePair>): Promise<void> {
  for (let i = 0; i < 4; i++) {
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe('live board (ISC-371)', () => {
  it('one live load per tick: board, open card and matrix share a single /live read', async () => {
    // jsdom has no modal dialog; the card detail opens one.
    const proto = HTMLDialogElement.prototype as unknown as Record<string, unknown>;
    proto['showModal'] = function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
    proto['close'] = function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    };
    let liveReads = 0;
    const refreshes = signal(0);
    TestBed.configureTestingModule({
      imports: [
        TranslocoTestingModule.forRoot({
          langs: CATALOGUES,
          translocoConfig: { availableLangs: [...LANGS], defaultLang: 'en' },
          preloadLangs: true,
        }),
      ],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: ApiClient,
          useValue: {
            frames: () => Promise.resolve({ kind: 'ok', body: HISTORY }),
            live: () => {
              liveReads++;
              return Promise.resolve({ kind: 'ok', body: LIVE });
            },
            tasks: () => Promise.resolve({ kind: 'error', status: 404 }),
          },
        },
        { provide: ShellState, useValue: { ws: signal('harbor'), specId: signal('002'), tier: signal('wide'), zen: signal(false) } },
        { provide: ShellData, useValue: { spec: { value: () => undefined }, specRows: () => [], archiveRows: () => [], planningModel: () => null } },
        { provide: RefreshService, useValue: { lastRefresh: signal(0), refreshes } },
      ],
    });
    const http = TestBed.inject(HttpTestingController);
    const loaded = TestBed.inject(SettingsService).load();
    http.expectOne((r) => r.method === 'GET' && r.url === SETTINGS_URL).flush({});
    await loaded;
    await TestBed.inject(Router).navigateByUrl('/');
    const fixture = TestBed.createComponent(LivePair);
    await settle(fixture);
    const host = fixture.nativeElement as HTMLElement;

    // Open one card's detail on the board.
    const open = host.querySelector<HTMLButtonElement>('app-board-tab article[data-card] button.id');
    expect(open).not.toBeNull();
    open?.click();
    await settle(fixture);
    expect(host.querySelector('app-card-detail')).not.toBeNull();
    expect(host.querySelector('app-matrix-tab')).not.toBeNull();
    // The first read: one for all three readers.
    expect(liveReads).toBe(1);

    for (let tick = 1; tick <= 3; tick++) {
      refreshes.update((n) => n + 1);
      await settle(fixture);
      expect(liveReads).toBe(1 + tick);
    }
  });
});
