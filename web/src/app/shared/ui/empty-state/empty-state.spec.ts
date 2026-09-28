import { TestBed } from '@angular/core/testing';
import { UiEmptyState } from './empty-state';

describe('UiEmptyState', () => {
  it('renders the title, body and a decorative icon', async () => {
    const fixture = TestBed.createComponent(UiEmptyState);
    fixture.componentRef.setInput('heading', 'Add your first workspace');
    fixture.componentRef.setInput('body', 'It appears here on the next refresh');
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector('.title')?.textContent).toBe('Add your first workspace');
    expect(host.querySelector('.body')?.textContent).toBe('It appears here on the next refresh');
    expect(host.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });
});
