import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { UiIdeaChip } from './idea-chip';

describe('UiIdeaChip', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
  });

  async function render(inputs: Record<string, unknown>) {
    const fixture = TestBed.createComponent(UiIdeaChip);
    for (const [key, value] of Object.entries(inputs)) fixture.componentRef.setInput(key, value);
    await fixture.whenStable();
    return { fixture, host: fixture.nativeElement as HTMLElement };
  }

  it('links the story slug to its read-only idea page, with the lightbulb glyph', async () => {
    const { host } = await render({ ws: 'demo', slug: 'board-swimlanes' });
    const link = host.querySelector<HTMLAnchorElement>('a.idea');

    expect(link?.getAttribute('href')).toBe('/w/demo/ideas/board-swimlanes');
    expect(link?.querySelector('ui-icon svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(link?.querySelector('.text')?.textContent.trim()).toBe('board-swimlanes');
    expect(link?.querySelector('.text')?.classList.contains('mono')).toBe(true);
  });

  it('shows the title instead of the slug when one is given, and keeps the slug in the link', async () => {
    const { host } = await render({ ws: 'demo', slug: 'board-swimlanes', title: 'Swimlanes on the board' });
    const link = host.querySelector<HTMLAnchorElement>('a.idea');

    expect(link?.querySelector('.text')?.textContent.trim()).toBe('Swimlanes on the board');
    expect(link?.querySelector('.text')?.classList.contains('mono')).toBe(false);
    expect(link?.getAttribute('href')).toBe('/w/demo/ideas/board-swimlanes');
    expect(link?.getAttribute('title')).toBe('board-swimlanes');
  });

  it('encodes a workspace or slug that needs it into the path', async () => {
    const { host } = await render({ ws: 'my ws', slug: 'a-b' });

    expect(host.querySelector('a')?.getAttribute('href')).toBe('/w/my%20ws/ideas/a-b');
  });
});
