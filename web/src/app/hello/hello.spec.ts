import { TestBed } from '@angular/core/testing';
import { HelloComponent } from './hello';

describe('HelloComponent', () => {
  it('renders the Spectant heading and the greeting', async () => {
    const fixture = TestBed.createComponent(HelloComponent);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector('h1')?.textContent.trim()).toBe('Spectant');
    expect(host.textContent).toContain('hello, spectant');
  });
});
