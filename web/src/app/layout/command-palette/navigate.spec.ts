import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';
import type { PaletteEntry } from '../../core/palette-sources';
import { follow, isCommitEnter } from './navigate';

@Component({ selector: 'app-navigate-target', template: '', changeDetection: ChangeDetectionStrategy.OnPush })
class Target {}

const entry = (link: PaletteEntry['link']): PaletteEntry => ({ id: 'x', label: 'x', link, keywords: [] });
const key = (init: KeyboardEventInit): KeyboardEvent => new KeyboardEvent('keydown', init);

describe('palette Enter (ISC-60.2)', () => {
  it('commits on a plain Enter', () => {
    expect(isCommitEnter(key({ key: 'Enter' }))).toBe(true);
  });

  it('leaves an Enter that commits an IME composition to the input method', () => {
    expect(isCommitEnter(key({ key: 'Enter', isComposing: true }))).toBe(false);
    // WebKit sends the committing Enter with isComposing already false but keyCode 229.
    expect(isCommitEnter(key({ key: 'Enter', keyCode: 229 }))).toBe(false);
  });

  it('ignores every other key', () => {
    expect(isCommitEnter(key({ key: 'ArrowDown' }))).toBe(false);
    expect(isCommitEnter(key({ key: 'Process' }))).toBe(false);
  });

  describe('follow', () => {
    let router: Router;

    beforeEach(() => {
      TestBed.configureTestingModule({ providers: [provideRouter([{ path: '**', component: Target }])] });
      router = TestBed.inject(Router);
    });

    it('navigates a router link in the app', async () => {
      await expect(follow(router, entry(['/w', 'harbor', 's', '002']))).resolves.toBe(true);
      expect(router.url).toBe('/w/harbor/s/002');
    });

    it('navigates a URL string with its fragment', async () => {
      await expect(follow(router, entry('/w/harbor/features#F2'))).resolves.toBe(true);
      expect(router.url).toBe('/w/harbor/features#F2');
    });
  });
});
