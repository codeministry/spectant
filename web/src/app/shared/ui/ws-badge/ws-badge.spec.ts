import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { UiWsBadge } from './ws-badge';
import { UiWsCover } from './ws-cover';
import { WS_ACCENT_TOKENS, wsAccent, wsMonogram, wsPattern } from './ws-identity';

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

@Component({
  imports: [UiWsCover],
  template: `
    <ui-ws-cover name="harbor" shape="tile" />
    <ui-ws-cover name="spectant" shape="tile" monogram="SP" [logo]="logo()" />
    <ui-ws-cover name="quay" shape="tile" image="assets/ws/quay.jpg" alt="Screenshot of quay" />
  `,
})
class TileHost {
  readonly logo = signal<string | null>(null);
}

describe('workspace cover, tile shape (spec 066 T7, ISC-519)', () => {
  it('marks the host as a tile and draws the neutral placeholder with the 88 px badge in the accent, no ring and no dot', async () => {
    const fixture = TestBed.createComponent(TileHost);
    await fixture.whenStable();
    const [plain] = [...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('ui-ws-cover')];
    expect(plain.getAttribute('data-shape')).toBe('tile');
    const placeholder = plain.querySelector<HTMLElement>('[data-cover-placeholder]');
    expect(placeholder).not.toBeNull();
    const badge = placeholder?.querySelector<HTMLElement>('ui-ws-badge');
    expect(badge?.getAttribute('data-size')).toBe('xl');
    expect(badge?.getAttribute('data-tone')).toBe('accent');
    expect(badge?.textContent.trim()).toBe('HA');
    expect(badge?.style.getPropertyValue('--ws')).toBe(WS_ACCENT_TOKENS[wsAccent('harbor')].mark);
    expect(badge?.style.getPropertyValue('--ws-ink')).toBe(WS_ACCENT_TOKENS[wsAccent('harbor')].ink);
    expect(plain.querySelector('svg, path, circle')).toBeNull();
  });

  it('shows the logo in the placeholder badge when one is set, the given monogram otherwise', async () => {
    const fixture = TestBed.createComponent(TileHost);
    await fixture.whenStable();
    const given = (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('ui-ws-cover')[1];
    expect(given.querySelector('[data-cover-placeholder] ui-ws-badge')?.textContent.trim()).toBe('SP');
    const loopback = '/api/workspaces/spectant/images/logo?v=0123456789abcdef';
    fixture.componentInstance.logo.set(loopback);
    await fixture.whenStable();
    expect(given.querySelector('[data-cover-placeholder] ui-ws-badge img')?.getAttribute('src')).toBe(loopback);
    fixture.componentInstance.logo.set('https://cdn.example/logo.png');
    await fixture.whenStable();
    expect(given.querySelector('[data-cover-placeholder] ui-ws-badge img')).toBeNull();
  });

  it('shows the screenshot without a placeholder, while card and thumb keep the name pattern', async () => {
    const fixture = TestBed.createComponent(TileHost);
    await fixture.whenStable();
    const shot = (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('ui-ws-cover')[2];
    expect(shot.querySelector(':scope > img')?.getAttribute('alt')).toBe('Screenshot of quay');
    expect(shot.querySelector('[data-cover-placeholder]')).toBeNull();
    const host = TestBed.createComponent(Host);
    await host.whenStable();
    const root = host.nativeElement as HTMLElement;
    expect(root.querySelector('ui-ws-cover [data-cover-placeholder]')).toBeNull();
    expect(root.querySelector('ui-ws-cover svg[data-icon-exempt] circle')).not.toBeNull();
  });
});
