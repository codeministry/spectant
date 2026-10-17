import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslocoService, TranslocoTestingModule } from '@jsverse/transloco';
import { CATALOGUES, LANGS } from '../../../../i18n/catalogues';
import type { BacklogRefusal } from './refusal';
import { RefusalNotice } from './refusal-notice';

// T21 · ISC-198 (design 037 § Ablehnung): the board's `app-refusal-notice`, moved to shared/ui for its second consumer,
// also renders a backlog write that was not accepted. Head "F8 not moved" or "Priority of F8 not changed", then
// `ui-reason` with core's phrase verbatim (422, fail tone, `alert`), "changed on disk · re-read" (409, warning tone,
// `status`) or the status (anything else, fail tone). The ✕ emits `closed`. The board's own cases stay in
// board-drag.spec.ts.

@Component({
  imports: [RefusalNotice],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<app-refusal-notice [refusal]="refusal()" (closed)="closed = closed + 1" />`,
})
class Host {
  readonly refusal = signal<BacklogRefusal>({ op: 'move', feature: 'F8', priority: null, kind: 'refused', reason: 'F8 is not in that milestone' });
  closed = 0;
}

let fixture: ComponentFixture<Host>;

async function mount(refusal: BacklogRefusal, lang: 'en' | 'de' = 'en'): Promise<HTMLElement> {
  TestBed.configureTestingModule({
    imports: [TranslocoTestingModule.forRoot({ langs: CATALOGUES, translocoConfig: { availableLangs: [...LANGS], defaultLang: 'en' }, preloadLangs: true })],
  });
  TestBed.inject(TranslocoService).setActiveLang(lang);
  fixture = TestBed.createComponent(Host);
  fixture.componentInstance.refusal.set(refusal);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('app-refusal-notice') as HTMLElement;
}

const text = (el: Element | null | undefined): string => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');

describe('refusal-notice for a backlog write (T21, ISC-198)', () => {
  it("a refused move: the head names the feature, the reason is core's phrase verbatim, fail tone as an alert", async () => {
    const n = await mount({ op: 'move', feature: 'F8', priority: null, kind: 'refused', reason: 'F8 is not in that milestone' });
    expect(n.getAttribute('data-refusal')).toBe('refused');
    expect(n.getAttribute('data-op')).toBe('move');
    expect(text(n.querySelector('[data-head]'))).toBe('F8 not moved');
    expect(text(n.querySelector('ui-reason .phrase'))).toBe('F8 is not in that milestone');
    expect(n.querySelector('ui-notice')?.getAttribute('role')).toBe('alert');
  });

  it('a refused priority: its own head', async () => {
    const n = await mount({ op: 'priority', feature: 'F8', priority: 'P1', kind: 'refused', reason: 'F8 already has P1' });
    expect(n.getAttribute('data-op')).toBe('priority');
    expect(text(n.querySelector('[data-head]'))).toBe('Priority of F8 not changed');
    expect(text(n.querySelector('ui-reason .phrase'))).toBe('F8 already has P1');
  });

  it('a stale write: warning tone as a status, "changed on disk · re-read"', async () => {
    const n = await mount({ op: 'move', feature: 'F8', priority: null, kind: 'stale' });
    expect(n.getAttribute('data-refusal')).toBe('stale');
    expect(text(n.querySelector('[data-head]'))).toBe('F8 not moved');
    expect(text(n.querySelector('ui-reason .phrase'))).toBe('changed on disk · re-read');
    expect(n.querySelector('ui-notice')?.getAttribute('role')).toBe('status');
  });

  it('a failed write names the status, or says no answer came', async () => {
    let n = await mount({ op: 'priority', feature: 'F8', priority: 'P2', kind: 'failed', status: 500 });
    expect(n.getAttribute('data-refusal')).toBe('failed');
    expect(text(n.querySelector('ui-reason .phrase'))).toBe('The change could not be written (status 500)');
    expect(n.querySelector('ui-notice')?.getAttribute('role')).toBe('alert');
    fixture.componentInstance.refusal.set({ op: 'priority', feature: 'F8', priority: 'P2', kind: 'failed', status: 0 });
    fixture.detectChanges();
    n = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('app-refusal-notice') as HTMLElement;
    expect(text(n.querySelector('ui-reason .phrase'))).toBe('The change could not be written (no answer)');
  });

  it('German heads and texts come from the de catalogue', async () => {
    const n = await mount({ op: 'move', feature: 'F8', priority: null, kind: 'stale' }, 'de');
    expect(text(n.querySelector('[data-head]'))).toBe('F8 nicht verschoben');
    expect(text(n.querySelector('ui-reason .phrase'))).toBe('auf der Festplatte geändert · neu gelesen');
    fixture.componentInstance.refusal.set({ op: 'priority', feature: 'F8', priority: 'P1', kind: 'refused', reason: 'x' });
    fixture.detectChanges();
    expect(text(n.querySelector('[data-head]'))).toBe('Priorität von F8 nicht geändert');
  });

  it('the ✕ emits closed', async () => {
    const n = await mount({ op: 'move', feature: 'F8', priority: null, kind: 'refused', reason: 'no' });
    n.querySelector<HTMLButtonElement>('[data-dismiss]')?.click();
    expect(fixture.componentInstance.closed).toBe(1);
  });
});
