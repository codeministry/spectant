import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { isOpenKey, OPEN_PARAM, OpenState, parseOpen, sectionKey, serializeOpen, withOpen, withOpenEach } from './open-state';

describe('open state', () => {
  describe('parseOpen', () => {
    it('reads a comma-separated list of keys in their order', () => {
      expect(parseOpen('specs,tldr,overlaps,s-approach')).toEqual(['specs', 'tldr', 'overlaps', 's-approach']);
    });

    it('reads nothing from an absent or empty value', () => {
      expect(parseOpen(null)).toEqual([]);
      expect(parseOpen(undefined)).toEqual([]);
      expect(parseOpen('')).toEqual([]);
    });

    it('drops empty entries, blanks, duplicates and unknown keys', () => {
      expect(parseOpen(' specs ,,tldr,specs,board,s-,s-a b,S-x')).toEqual(['specs', 'tldr']);
    });
  });

  describe('isOpenKey and sectionKey', () => {
    it('knows the three fixed keys and one key per library section', () => {
      expect(['specs', 'tldr', 'overlaps', 's-open-points'].every(isOpenKey)).toBe(true);
      expect(['', 'density', 'steps', 's-', 's-a,b', 's-a b'].some(isOpenKey)).toBe(false);
      expect(sectionKey('open-points')).toBe('s-open-points');
    });
  });

  describe('serializeOpen', () => {
    it('joins the valid keys with commas, each once', () => {
      expect(serializeOpen(['tldr', 'specs', 'tldr', 'nope', 's-risks'])).toBe('tldr,specs,s-risks');
    });

    it('is null for no keys, so the param leaves the address', () => {
      expect(serializeOpen([])).toBeNull();
      expect(serializeOpen(['nope'])).toBeNull();
    });
  });

  describe('withOpen', () => {
    it('adds a key at the end and keeps the others', () => {
      expect(withOpen('specs', 'tldr', true)).toBe('specs,tldr');
      expect(withOpen(null, 'overlaps', true)).toBe('overlaps');
    });

    it('does not add a key twice', () => {
      expect(withOpen('specs,tldr', 'specs', true)).toBe('specs,tldr');
    });

    it('removes a key, and the last removal yields null', () => {
      expect(withOpen('specs,tldr', 'specs', false)).toBe('tldr');
      expect(withOpen('tldr', 'tldr', false)).toBeNull();
      expect(withOpen(null, 'tldr', false)).toBeNull();
    });
  });

  describe('OpenState', () => {
    @Component({ template: '' })
    class Blank {}

    let router: Router;
    let state: OpenState;

    beforeEach(async () => {
      TestBed.configureTestingModule({ providers: [provideRouter([{ path: 'w/:ws', component: Blank }])] });
      router = TestBed.inject(Router);
      await router.navigateByUrl('/w/harbor?density=compact&steps=1&open=tldr');
      state = TestBed.inject(OpenState);
    });

    it('reads the open keys from the address', () => {
      expect(state.keys()).toEqual(['tldr']);
      expect(state.isOpen('tldr')).toBe(true);
      expect(state.isOpen('specs')).toBe(false);
    });

    it('opens a key in the address and leaves the path and every other param alone', async () => {
      await state.set('specs', true);
      const tree = router.parseUrl(router.url);
      expect(router.url.startsWith('/w/harbor?')).toBe(true);
      expect(tree.queryParamMap.get(OPEN_PARAM)).toBe('tldr,specs');
      expect(tree.queryParamMap.get('density')).toBe('compact');
      expect(tree.queryParamMap.get('steps')).toBe('1');
      expect(state.isOpen('specs')).toBe(true);
    });

    it('drops the param once the last key closes', async () => {
      await state.set('tldr', false);
      const tree = router.parseUrl(router.url);
      expect(tree.queryParamMap.has(OPEN_PARAM)).toBe(false);
      expect(tree.queryParamMap.get('density')).toBe('compact');
      expect(state.keys()).toEqual([]);
    });

    it('opens and closes several keys in one address change (withOpenEach)', async () => {
      expect(withOpenEach('tldr,s-a', [['s-a', false], ['s-b', true], ['s-c', true]])).toBe('tldr,s-b,s-c');
      expect(withOpenEach(null, [['s-a', false]])).toBeNull();
      await router.navigateByUrl('/w/harbor?density=compact&open=tldr#002-x/plan.md');
      await state.assign([['tldr', false], ['s-x', true], ['s-y', true]]);
      expect(router.parseUrl(router.url).fragment).toBe('002-x/plan.md');
      expect(router.parseUrl(router.url).queryParamMap.get(OPEN_PARAM)).toBe('s-x,s-y');
      expect(router.parseUrl(router.url).queryParamMap.get('density')).toBe('compact');
    });

    it('toggles a key', async () => {
      await state.toggle(sectionKey('risks'));
      expect(state.isOpen('s-risks')).toBe(true);
      await state.toggle('s-risks');
      expect(state.isOpen('s-risks')).toBe(false);
    });

    it('follows a navigation made elsewhere', async () => {
      await router.navigateByUrl('/w/harbor?open=overlaps,specs');
      expect(state.keys()).toEqual(['overlaps', 'specs']);
    });
  });
});
