/**
 * The stub API's harbor workspace as the e2e suites read it (`core/fixtures/harbor*.golden.json`), the three width
 * tiers with where the Spec context lives at each, and the small page steps several suites share (follow a link,
 * open the settings menu, the PAGE select or the assistant). Nothing here asserts on markup beyond the hooks it names.
 */
import { readFileSync } from 'node:fs';
import type { Locator, Page } from '@playwright/test';
import type { SpecPageModel } from '../../core/src/files.ts';
import { expect, headerControl } from './fixtures';

// Read, not imported: Playwright's ESM loader wants an import attribute the web tsconfig does not take.
export const read = (file: string): unknown => JSON.parse(readFileSync(new URL(`../../core/fixtures/${file}`, import.meta.url), 'utf8'));

const SPECS = read('harbor.spec.golden.json') as Record<string, SpecPageModel>;
export function spec(path: string): SpecPageModel {
  const model = SPECS[path];
  if (!model) throw new Error(`harbor.spec.golden.json holds no ${path}`);
  return model;
}

export type WarningItem = { readonly spec: string; readonly warning: { readonly kind: string; readonly text: string; readonly command?: string } };
export type WarningGroup = { readonly items: readonly WarningItem[] };
const WORKSPACE = read('harbor.golden.json') as { readonly warningGroups: readonly WarningGroup[] };
/** Every warning of the harbor workspace dashboard, in the order of its warning groups. */
export const WARNED = WORKSPACE.warningGroups.flatMap((group) => group.items);

export const TIERS = [
  { width: 390, tier: 'compact', rail: false },
  { width: 820, tier: 'medium', rail: false },
  { width: 1440, tier: 'wide', rail: true },
] as const;

/** Where the Spec context and the Warnings list live at this width: the rail from 1120 px, else the main column. */
export const home = (page: Page, rail: boolean): Locator => page.locator(rail ? 'aside.shell-rail' : 'main#main');

export async function top(locator: Locator): Promise<number> {
  const box = await locator.boundingBox();
  if (!box) throw new Error('element has no box');
  return box.y;
}

/** The settings button, once the deferred menus have mounted (before that it leads to /settings, its fallback). */
export const openSettings = async (page: Page): Promise<void> => {
  await (await headerControl(page, 'settings')).click();
};

export const openAssistant = async (page: Page): Promise<void> => {
  const trigger = await headerControl(page, 'assistant');
  // Today the trigger is only the dot's place (aria-disabled); fail on that rather than wait out the click.
  await expect(trigger).not.toHaveAttribute('aria-disabled', 'true');
  await trigger.click();
};

export const follow =
  (selector: string) =>
  async (page: Page): Promise<void> => {
    const link = page.locator(selector).first();
    await expect(link).toBeVisible();
    await link.click();
  };
export const viaSettings =
  (entry: string) =>
  async (page: Page): Promise<void> => {
    await (await headerControl(page, 'settings')).click();
    await follow(`[data-menu="settings"] [data-settings-link="${entry}"]`)(page);
  };
/** A page of the PAGE select's menu (spec 024 T80): the select, then the entry. // spec 024: PAGE select (principal 2026-10-13) */
export const viaPage =
  (id: string) =>
  async (page: Page): Promise<void> => {
    await (await headerControl(page, 'page')).click();
    await follow(`nav[aria-label="Pages"] [data-page="${id}"]`)(page);
  };
