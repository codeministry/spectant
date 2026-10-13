import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { afterEach, beforeEach, vi } from 'vitest';
import type { EvidenceFile, EvidenceListing } from '../../../../../../../core/src/files';
import { CATALOGUES, LANGS } from '../../../../../i18n/catalogues';
import { ApiClient, type ApiResult, type EvidenceTextResult } from '../../../../core/api.service';
import { SPEC_AREA_ROUTES } from '../../spec-area.routes';

const ok = <T>(body: T): ApiResult<T> => ({ kind: 'ok', body, etag: null, notModified: false });

const file = (path: string, patch: Partial<EvidenceFile> = {}): EvidenceFile => {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const ext = name.slice(name.lastIndexOf('.') + 1);
  const mediaType = { md: 'text/markdown', png: 'image/png', log: 'text/plain', har: 'application/json' }[ext] ?? 'application/octet-stream';
  return { group: path.startsWith('artifacts/') ? 'artifacts' : 'evidence', path, name, bytes: 1536, mediaType, task: null, claim: null, ...patch };
};

const REPORT = file('artifacts/T12-report.md', { claim: 'ISC-1' });
const SHOT = file('.evidence/shot.png', { claim: 'ISC-1' });
const LOG = file('.evidence/run.log', { claim: 'ISC-2' });
const HAR = file('.evidence/dashboard.har');
const ESCAPED = file('.evidence/escape.png', { symlink: true, refused: 'symlink-escape', bytes: 0 });

const LISTING: EvidenceListing = {
  results: [REPORT],
  raw: [SHOT, LOG, HAR, ESCAPED],
  byClaim: { 'ISC-1': [REPORT, SHOT], 'ISC-2': [LOG] },
  ungrouped: [HAR, ESCAPED],
  diagnostics: [],
};

const EMPTY: EvidenceListing = { results: [], raw: [], byClaim: {}, ungrouped: [], diagnostics: [] };

let texts: Record<string, EvidenceTextResult> = {};

function setUp(listing: EvidenceListing): void {
  const api: Pick<ApiClient, 'workspaces' | 'dashboard' | 'spec' | 'evidence' | 'evidenceText'> = {
    workspaces: () => Promise.resolve(ok([])),
    dashboard: () => Promise.resolve({ kind: 'not-found', served: false }),
    spec: () => Promise.resolve({ kind: 'not-found', served: false }),
    evidence: () => Promise.resolve(ok(listing)),
    evidenceText: (_ws, _id, path) => Promise.resolve(texts[path] ?? { kind: 'error', status: 404 }),
  };
  TestBed.configureTestingModule({
    imports: [
      TranslocoTestingModule.forRoot({
        langs: CATALOGUES,
        translocoConfig: { availableLangs: [...LANGS], defaultLang: 'en' },
        preloadLangs: true,
      }),
    ],
    providers: [
      provideRouter([{ path: 'w/:ws/s/:id', children: SPEC_AREA_ROUTES }]),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: ApiClient, useValue: api },
    ],
  });
}

async function settle(harness: RouterTestingHarness): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    harness.detectChanges();
    await harness.fixture.whenStable();
  }
}

async function open(listing: EvidenceListing): Promise<{ harness: RouterTestingHarness; root: HTMLElement }> {
  setUp(listing);
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl('/w/harbor/s/002/evidence');
  await settle(harness);
  return { harness, root: harness.routeNativeElement as HTMLElement };
}

const row = (root: HTMLElement, path: string) => root.querySelector<HTMLElement>(`[data-file="${path}"]`);

describe('EvidenceTab', () => {
  beforeEach(() => {
    texts = {};
    // jsdom has no `showModal()` / `close()`; stubbed the way a browser behaves (dialog.spec.ts).
    const proto = HTMLDialogElement.prototype as unknown as Record<string, unknown>;
    proto['showModal'] = vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    });
    proto['close'] = vi.fn(function (this: HTMLDialogElement) {
      if (!this.hasAttribute('open')) return;
      this.removeAttribute('open');
      this.dispatchEvent(new Event('close'));
    });
  });

  afterEach(() => {
    const proto = HTMLDialogElement.prototype as unknown as Record<string, unknown>;
    delete proto['showModal'];
    delete proto['close'];
  });

  it('groups every file under its folder (Results, Raw evidence) and marks each with its claim', async () => {
    const { root } = await open(LISTING);
    // spec 024: prototype value (principal: Prototyp gilt immer): the prototype groups by folder and shows the claim as a chip on every file.
    const groups = [...root.querySelectorAll<HTMLElement>('[data-evidence-group]')].map((g) => g.dataset['evidenceGroup']);
    expect(groups).toEqual(['results', 'raw']);
    for (const f of [REPORT, SHOT, LOG, HAR, ESCAPED]) expect(row(root, f.path)).not.toBeNull();
    expect(root.querySelector(`[data-evidence-group="results"] [data-file="${REPORT.path}"][data-claim="ISC-1"]`)).not.toBeNull();
    expect(root.querySelector(`[data-evidence-group="raw"] [data-file="${SHOT.path}"][data-thumb][data-claim="ISC-1"]`)).not.toBeNull();
    expect(root.querySelector(`[data-evidence-group="raw"] [data-file="${LOG.path}"][data-claim="ISC-2"]`)?.textContent).toContain('run.log');
    expect(root.querySelector(`[data-file="${HAR.path}"]`)?.getAttribute('data-claim')).toBe('none');
    // The claim chip links to the claim card in the Claims tab.
    const links = [...root.querySelectorAll<HTMLAnchorElement>('[data-claim-link]')].map((a) => a.getAttribute('href'));
    expect(links).toContain('/w/harbor/s/002/claims#claim-ISC-2');
  });

  it('shows the size of a file row', async () => {
    const { root } = await open(LISTING);
    expect(row(root, REPORT.path)?.textContent).toContain('1.5 KB');
  });

  it('renders a refused file as an error row, never as a preview', async () => {
    const { root } = await open(LISTING);
    const refused = row(root, ESCAPED.path);
    expect(refused?.dataset['error']).toBe('refused');
    expect(refused?.querySelector('img, button')).toBeNull();
  });

  it('opens a markdown file in the dialog, rendered by core', async () => {
    texts[REPORT.path] = { kind: 'ok', text: '# Dashboard model\n\nAll **green**.' };
    const { harness, root } = await open(LISTING);
    row(root, REPORT.path)?.click();
    await settle(harness);
    const dialog = root.querySelector<HTMLDialogElement>('dialog[data-preview]');
    expect(dialog?.open).toBe(true);
    expect(dialog?.querySelector('[data-preview-path]')?.textContent).toContain(REPORT.path);
    expect(dialog?.querySelector('[data-preview-body] h1')?.textContent).toContain('Dashboard model');
    expect(dialog?.querySelector('[data-preview-body] strong')?.textContent).toBe('green');
  });

  it('opens an image thumbnail in the dialog with the path and the image', async () => {
    const { harness, root } = await open(LISTING);
    row(root, SHOT.path)?.click();
    await settle(harness);
    const dialog = root.querySelector<HTMLDialogElement>('dialog[data-preview]');
    expect(dialog?.open).toBe(true);
    expect(dialog?.querySelector('[data-preview-path]')?.textContent).toContain(SHOT.path);
    expect(dialog?.querySelector('img')?.getAttribute('src')).toContain('path=.evidence%2Fshot.png');
  });

  it('turns a file the server refuses (403) into an error row and keeps the dialog closed', async () => {
    texts[REPORT.path] = { kind: 'refused' };
    const { harness, root } = await open(LISTING);
    row(root, REPORT.path)?.click();
    await settle(harness);
    expect(row(root, REPORT.path)?.dataset['error']).toBe('refused');
    expect(root.querySelector<HTMLDialogElement>('dialog[data-preview]')?.open).toBe(false);
  });

  it('shows the empty state when the spec has no evidence', async () => {
    const { root } = await open(EMPTY);
    expect(root.querySelector('[data-evidence-group]')).toBeNull();
    expect(root.querySelector('ui-empty-state')?.textContent).toContain('No evidence');
  });
});
