import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { UiSectionHeader } from './section-header';

@Component({
  imports: [UiSectionHeader],
  template: `<ui-section-header heading="Specs" eyebrow="Workspace"><span meta>6 · 15 archived</span></ui-section-header>`,
})
class Host {}

describe('UiSectionHeader', () => {
  it('renders a focusable heading and projects the meta slot', async () => {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector('h2')?.textContent).toBe('Specs');
    expect(host.querySelector('h2')?.getAttribute('tabindex')).toBe('-1');
    expect(host.querySelector('.meta')?.textContent).toBe('6 · 15 archived');
  });
});
