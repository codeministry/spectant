import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { UiWsBadge } from './ws-badge';
import { UiWsCover } from './ws-cover';
import { wsAccent, wsMonogram, wsPattern } from './ws-identity';

@Component({
  imports: [UiWsBadge, UiWsCover],
  template: `
    <ui-ws-badge [name]="name()" size="lg" />
    <ui-ws-badge name="spectant" monogram="SP" accent="violet" [logo]="logo()" />
    <ui-ws-cover [name]="name()" />
    <ui-ws-cover name="spectant" image="assets/ws/spectant.jpg" alt="Screenshot of spectant" />
    <ui-ws-cover name="quay" shape="thumb" [image]="logo()" />
  `,
})
class Host {
  readonly name = signal('harbor');
  readonly logo = signal<string | null>(null);
}

describe('workspace identity (spec 024 T54)', () => {
  it('takes a same-origin image (bundled or the loopback /api route with its cache-bust) and refuses a remote one (spec 016 T18)', async () => {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    const given = root.querySelectorAll<HTMLElement>('ui-ws-badge')[1];
    const thumb = root.querySelectorAll<HTMLElement>('ui-ws-cover')[2];
    expect(thumb.getAttribute('data-shape')).toBe('thumb');
    expect(root.querySelectorAll('ui-ws-cover')[0].getAttribute('data-shape')).toBe('card');

    const loopback = '/api/workspaces/quay/images/logo?v=0123456789abcdef';
    fixture.componentInstance.logo.set(loopback);
    await fixture.whenStable();
    expect(given.querySelector('img')?.getAttribute('src')).toBe(loopback);
    expect(thumb.querySelector('img')?.getAttribute('src')).toBe(loopback);

    for (const remote of ['https://cdn.example/logo.png', '//cdn.example/logo.png', '/\\cdn.example/logo.png', 'data:image/png;base64,AA==', ' http://cdn.example/x.png']) {
      fixture.componentInstance.logo.set(remote);
      await fixture.whenStable();
      expect(given.querySelector('img')).toBeNull();
      expect(given.textContent.trim()).toBe('SP');
      expect(given.hasAttribute('data-logo')).toBe(false);
      expect(thumb.querySelector('img')).toBeNull();
      expect(thumb.querySelector('svg[data-icon-exempt]')).not.toBeNull();
    }
  });

  it('derives the monogram, a hash accent among the first five tokens and a stable pattern', () => {
    expect(wsMonogram('harbor')).toBe('HA');
    expect(wsMonogram('example-app')).toBe('EA');
    expect(wsMonogram('')).toBe('?');
    expect(['teal', 'cyan', 'lime', 'violet', 'orange']).toContain(wsAccent('harbor'));
    expect(wsPattern('harbor')).toEqual(wsPattern('harbor'));
    expect(wsPattern('harbor').arc).toMatch(/^M[\d.]+ [\d.]+ A34 34 0 1 1 [\d.]+ [\d.]+$/u);
  });

  it('renders the badge from the name, or the given monogram, accent and logo', async () => {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    const [plain, given] = [...root.querySelectorAll<HTMLElement>('ui-ws-badge')];
    expect(plain.textContent.trim()).toBe('HA');
    expect(plain.classList.contains('ws-badge')).toBe(true);
    expect(plain.getAttribute('data-size')).toBe('lg');
    expect(plain.getAttribute('aria-hidden')).toBe('true');
    expect(given.textContent.trim()).toBe('SP');
    expect(given.style.getPropertyValue('--ws')).toBe('var(--color-secondary)');
    fixture.componentInstance.logo.set('assets/logo.svg');
    await fixture.whenStable();
    expect(given.querySelector('img')?.getAttribute('src')).toBe('assets/logo.svg');
    expect(given.hasAttribute('data-logo')).toBe(true);
  });

  it('renders the cover as the name pattern without an image and as the screenshot with one', async () => {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const [pattern, shot] = [...(fixture.nativeElement as HTMLElement).querySelectorAll('ui-ws-cover')];
    expect(pattern.querySelector('svg[data-icon-exempt] path')).not.toBeNull();
    expect(pattern.querySelector('img')).toBeNull();
    expect(shot.querySelector('img')?.getAttribute('alt')).toBe('Screenshot of spectant');
    expect(shot.querySelector('svg')).toBeNull();
  });
});
