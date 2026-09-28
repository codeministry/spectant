import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { UiKbd } from './kbd';

@Component({ imports: [UiKbd], template: `<ui-kbd>Esc</ui-kbd>` })
class Host {}

describe('UiKbd', () => {
  it('wraps the key in a real kbd element', async () => {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).querySelector('ui-kbd kbd')?.textContent).toBe('Esc');
  });
});
