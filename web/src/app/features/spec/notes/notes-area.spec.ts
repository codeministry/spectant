import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { TranslocoService, TranslocoTestingModule } from '@jsverse/transloco';
import type { Note } from '../../../../../../server/src/notes.contract';
import { CATALOGUES, LANGS } from '../../../../i18n/catalogues';
import { ApiClient, type ApiResult } from '../../../core/api.service';
import { SettingsService } from '../../../core/settings.service';
import { ShellState } from '../../../layout/shell/shell-state.service';
import { formatInstant } from '../../../shared/time';
import { NotesArea } from './notes-area';

/** Two notes on harbor 002, updated on different days, so the row times differ. */
const NOTES: readonly Note[] = [
  {
    id: 'n-1',
    pinned: false,
    workspace: 'harbor',
    anchor: { kind: 'spec', spec: '002' },
    title: 'Rollout',
    body: 'first line',
    created: '2026-10-11T08:00:00.000Z',
    updated: '2026-10-12T12:02:00.000Z',
  },
  {
    id: 'n-2',
    pinned: false,
    workspace: 'harbor',
    anchor: null,
    title: 'Loose',
    body: 'second line',
    created: '2026-03-06T09:00:00.000Z',
    updated: '2026-03-06T23:30:00.000Z',
  },
];

const ok = <T>(body: T): ApiResult<T> => ({ kind: 'ok', body, etag: null, notModified: false });
/** The anchor picker's reads: not served here, so the picker lists no claims or tasks. */
const notServed = () => Promise.resolve({ kind: 'not-found', served: true } as const);

let harness: RouterTestingHarness | null = null;

function setUp(): void {
  const api: Pick<ApiClient, 'notes' | 'claims' | 'tasks'> = {
    notes: () => Promise.resolve(ok(NOTES)),
    claims: notServed,
    tasks: notServed,
  };
  const shell: Pick<ShellState, 'tier' | 'ws' | 'specId'> = { tier: signal('wide'), ws: signal('harbor'), specId: signal('002') } as never;
  const settings = { settings: signal({ notesImportDismissed: true }), load: () => Promise.resolve(), update: () => Promise.resolve() };
  TestBed.configureTestingModule({
    imports: [
      TranslocoTestingModule.forRoot({
        langs: CATALOGUES,
        translocoConfig: { availableLangs: [...LANGS], defaultLang: 'en' },
        preloadLangs: true,
      }),
    ],
    providers: [
      provideRouter([{ path: 'notes', component: NotesArea, children: [{ path: '', children: [] }, { path: ':noteId', children: [] }] }]),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: ApiClient, useValue: api },
      { provide: ShellState, useValue: shell },
      { provide: SettingsService, useValue: settings },
    ],
  });
}

async function open(url: string): Promise<HTMLElement> {
  harness ??= await RouterTestingHarness.create();
  await harness.navigateByUrl(url);
  await harness.fixture.whenStable();
  // The listing resolves after the first render; one more pass paints the rows and the editor.
  await new Promise((resolve) => setTimeout(resolve, 0));
  await harness.fixture.whenStable();
  return harness.fixture.nativeElement as HTMLElement;
}

const rowTimes = (root: HTMLElement) => [...root.querySelectorAll<HTMLTimeElement>('.notes-row-time time')];

describe('NotesArea: times through shared/time (spec 006, ISC-114.2)', () => {
  afterEach(() => {
    harness = null;
  });

  it('shows each row time as a <time> whose datetime is the note updated instant, in the instant form', async () => {
    setUp();
    const root = await open('/notes?filter=workspace');
    const times = rowTimes(root);
    expect(times.map((el) => el.getAttribute('datetime'))).toEqual(NOTES.map((note) => note.updated));
    expect(times.map((el) => el.textContent)).toEqual(NOTES.map((note) => formatInstant(note.updated, 'en')));
  });

  it('says saved with the time inside the sentence as a <time>, in English and German', async () => {
    setUp();
    const root = await open('/notes/n-1');
    const hint = root.querySelector<HTMLElement>('[data-save-state]');
    expect(hint?.dataset['state']).toBe('saved');
    const time = hint?.querySelector('time');
    expect(time?.getAttribute('datetime')).toBe('2026-10-12T12:02:00.000Z');
    expect(hint?.textContent).toBe(`saved · ${formatInstant('2026-10-12T12:02:00.000Z', 'en')}`);

    TestBed.inject(TranslocoService).setActiveLang('de');
    await harness?.fixture.whenStable();
    expect(hint?.textContent).toBe(`gespeichert · ${formatInstant('2026-10-12T12:02:00.000Z', 'de')}`);
    expect(hint?.querySelector('time')?.getAttribute('datetime')).toBe('2026-10-12T12:02:00.000Z');
  });
});
