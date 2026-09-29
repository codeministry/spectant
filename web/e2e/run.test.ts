// The Test Strategy's command shapes (spec 001) must reach Playwright as the calls below; `bun test web/e2e`.
import { describe, expect, test } from 'bun:test';

import { translate } from './run';

describe('run.ts translates the Test Strategy command shapes', () => {
  test('e2e: area file filter and grep pass through on chromium', () => {
    expect(translate('e2e', ['palette', '-g', 'open'])).toEqual({
      args: ['--project=chromium', 'palette', '-g', 'open'],
      env: { E2E_SUITE: 'e2e' },
    });
  });

  test('e2e: an explicit project replaces chromium and does not swallow the file filter (ISC-19.1)', () => {
    expect(translate('e2e', ['--project', 'webkit', 'smoke']).args).toEqual(['--project=webkit', 'smoke']);
    expect(translate('e2e', ['--project=webkit']).args).toEqual(['--project=webkit']);
  });

  test('visual: the group becomes a grep, --theme becomes E2E_THEME (ISC-17, ISC-17.1)', () => {
    expect(translate('visual', ['dashboard'])).toEqual({
      args: ['--project=chromium', '-g', 'dashboard'],
      env: { E2E_SUITE: 'visual' },
    });
    expect(translate('visual', ['overview', '--theme', 'dark'])).toEqual({
      args: ['--project=chromium', '-g', 'overview'],
      env: { E2E_SUITE: 'visual', E2E_THEME: 'dark' },
    });
    expect(translate('visual', ['dashboard', 'overview', '--theme=light', '-u']).args).toEqual([
      '--project=chromium',
      '-g',
      '(dashboard|overview)',
      '-u',
    ]);
  });

  test('browser: the area stays a file filter under browser/ (ISC-64 to ISC-66)', () => {
    expect(translate('browser', ['contrast'])).toEqual({
      args: ['--project=chromium', 'contrast'],
      env: { E2E_SUITE: 'browser' },
    });
  });

  test('an unknown theme or suite is refused', () => {
    expect(() => translate('visual', ['--theme', 'sepia'])).toThrow(/--theme=sepia/);
    expect(() => translate('unit', [])).toThrow(/suite=unit/);
  });
});
