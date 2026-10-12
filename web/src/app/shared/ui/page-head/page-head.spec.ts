import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { type PageHeadBack, UiPageHead } from './page-head';

@Component({
  imports: [UiPageHead],
  template: `<ui-page-head [segments]="segments()" [back]="back()"><h1 class="type-page-title" id="board">Board</h1></ui-page-head>`,
})
class Host {
  readonly segments = signal<readonly string[]>(['harbor', 'Board', 'Idea']);
  readonly back = signal<PageHeadBack | undefined>(undefined);
}

describe('UiPageHead', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
  });

  async function render(back?: PageHeadBack, segments?: readonly string[]) {
    const fixture = TestBed.createComponent(Host);
    if (segments) fixture.componentInstance.segments.set(segments);
    fixture.componentInstance.back.set(back);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  it('renders the segments as one plain-text eyebrow with aria-hidden separators, then the projected h1', async () => {
    const host = await render();
    const eyebrow = host.querySelector('[data-page-eyebrow]');

    expect(eyebrow?.tagName).toBe('P');
    expect(eyebrow?.classList.contains('type-eyebrow')).toBe(true);
    expect(eyebrow?.querySelector('a')).toBeNull();
    expect([...(eyebrow?.querySelectorAll('.segment') ?? [])].map((s) => s.textContent)).toEqual(['harbor', 'Board', 'Idea']);
    const separators = [...(eyebrow?.querySelectorAll('.sep') ?? [])];
    expect(separators).toHaveLength(2);
    expect(separators.every((s) => s.getAttribute('aria-hidden') === 'true' && s.textContent === ' · ')).toBe(true);
    expect(eyebrow?.textContent).toBe('harbor · Board · Idea');

    const h1 = host.querySelector('ui-page-head h1');
    expect(h1?.id).toBe('board');
    expect(eyebrow?.compareDocumentPosition(h1 as Node) ?? 0).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(host.querySelector('[data-page-back]')).toBeNull();
  });

  it('renders a single segment without a separator', async () => {
    const host = await render(undefined, ['All workspaces · 2']);
    const eyebrow = host.querySelector('[data-page-eyebrow]');

    expect(eyebrow?.querySelectorAll('.sep')).toHaveLength(0);
    expect(eyebrow?.textContent).toBe('All workspaces · 2');
  });

  it('puts the back link in front of the eyebrow, outside it, named by its label', async () => {
    const host = await render({ href: '/w/harbor/board', label: 'Back to the board' });
    const link = host.querySelector<HTMLAnchorElement>('a[data-page-back]');
    const eyebrow = host.querySelector('[data-page-eyebrow]');

    expect(link?.getAttribute('href')).toBe('/w/harbor/board');
    expect(link?.getAttribute('aria-label')).toBe('Back to the board');
    expect(link?.querySelector('ui-icon svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(eyebrow?.contains(link as Node)).toBe(false);
    expect(link?.compareDocumentPosition(eyebrow as Node) ?? 0).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });
});
