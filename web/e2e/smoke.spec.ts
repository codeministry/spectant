/**
 * ISC-19.1: WebKit (and Chromium) render `/` and `/w/:ws` with zero console errors.
 * `bun run e2e -- --project webkit smoke`. Placeholder so the layout lists; T78 lands the test.
 */
import { test } from './fixtures';

test('smoke: both routes render without console errors', () => {
  test.skip(true, 'T78 lands the smoke test');
});
