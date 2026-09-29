// Lets a bare `playwright test` in web/ find the one Playwright config, web/e2e/playwright.config.ts. Without it,
// Playwright would crawl web/ and load the Vitest and `bun test` files as its own (T28).
export { default } from './e2e/playwright.config.ts';
