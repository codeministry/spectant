/**
 * ISC-66 (Anti): under `prefers-reduced-motion: reduce` no animation or transition longer than 0 ms runs (T31).
 *
 *   bun run test:browser -- motion
 *
 * Runs against the primitives gallery (`/__ui?theme=light|dark`), which renders every primitive in every state, with
 * the preference emulated by `page.emulateMedia({ reducedMotion })` before the page loads (the config's browser tier
 * runs `no-preference`). Three checks per theme:
 *
 * 1. STATIC. Every element and its `::before`, `::after` and `::backdrop` is read at rest (and again after every
 *    interaction below): a `transition-property` other than `none` with a combined duration (duration + delay) above
 *    0, or an `animation-name` other than `none` with a combined duration above 0, is a failure. A combined duration
 *    is what makes the platform create a transition or keep an animation in effect at all; `0s` everywhere is the
 *    reduced-motion contract of `src/styles/motion.css`.
 * 2. DYNAMIC. A recorder installed before any script logs every `transitionrun` and `animationstart` from the first
 *    paint on. Then the interactions the primitives animate are driven for real: hover a button of every variant, the
 *    icon button, the interactive card and the linked KPI tile; focus and press a filter chip; open and close both
 *    disclosures; close and reopen the popover; open and close the dialog and the sheet; change the segmented value;
 *    restart the skeleton sweep. After each step: `document.getAnimations()` holds no animation whose computed end
 *    time is above 0, the moved element's own `getAnimations({ subtree: true })` is empty, and the recorder saw no
 *    transition (the platform creates none at a combined duration of 0) and no animation with an end time above 0.
 *    The recorder catches an 80 ms transition that would finish between two Playwright round trips.
 * 3. CONTROL. The same page under `no-preference` must record motion on the disclosure and on a button hover and must
 *    show non-zero durations at rest, so the emulation demonstrably reaches the page: a page with no motion at all
 *    would otherwise pass (1) and (2) trivially.
 *
 * Every failure names the `data-gallery` owner, the element (tag and classes, pseudo-element) and the property.
 * Zero failures under reduce is the threshold.
 */
import { awaitReady, expect, test } from '../fixtures';

type Page = Parameters<typeof awaitReady>[0];
type Theme = 'light' | 'dark';
type Preference = 'reduce' | 'no-preference';

/** One `transitionrun` / `animationstart` seen by the in-page recorder. */
type Recorded = { kind: 'transition' | 'animation'; name: string; where: string; step: string; endTime: number | null };

/** One element (or pseudo-element) whose computed style allows motion. */
type StaticHit = { where: string; property: string; value: string };

/** Below these the gallery did not render; a green run over nothing proves nothing. */
const MIN_GALLERY = 60;
const MIN_ELEMENTS = 300;

/**
 * Installed with `addInitScript`, so it runs before the app: logs every transition and animation the page starts,
 * tagged with the current step (`window.__motionStep`, set by `step()`). Self-contained, since Playwright serialises
 * the source.
 */
function installRecorder(): void {
  const w = window as unknown as { __motion: Recorded[]; __motionStep: string };
  w.__motion = [];
  w.__motionStep = 'load';
  const where = (target: EventTarget | null, pseudo: string): string => {
    if (!(target instanceof Element)) return '(not an element)';
    const owner = target.closest('[data-gallery]')?.getAttribute('data-gallery') ?? '(no data-gallery)';
    const classes = [...target.classList].filter((c) => !c.startsWith('ng-')).join('.');
    return `${owner} > ${target.tagName.toLowerCase()}${classes ? `.${classes}` : ''}${pseudo}`;
  };
  /** The end time of the animation the event belongs to, if it is still reachable. */
  const endOf = (target: EventTarget | null, match: (a: Animation) => boolean): number | null => {
    if (!(target instanceof Element)) return null;
    const found = target.getAnimations().find(match);
    const end = found?.effect?.getComputedTiming().endTime;
    return typeof end === 'number' ? end : null;
  };
  document.addEventListener(
    'transitionrun',
    (e) => {
      w.__motion.push({
        kind: 'transition',
        name: e.propertyName,
        where: where(e.target, e.pseudoElement),
        step: w.__motionStep,
        endTime: endOf(e.target, (a) => a instanceof CSSTransition && a.transitionProperty === e.propertyName),
      });
    },
    true,
  );
  /** Duration + delay of `name` from the computed style, for an animation that already left `getAnimations()`. */
  const computedEnd = (target: EventTarget | null, pseudo: string, name: string): number | null => {
    if (!(target instanceof Element)) return null;
    const s = getComputedStyle(target, pseudo || null);
    const index = s.animationName.split(',').map((n) => n.trim()).indexOf(name);
    if (index < 0) return null;
    const ms = (list: string): number => {
      const parts = list.split(',');
      const v = (parts[index % parts.length] ?? '0s').trim();
      return v.endsWith('ms') ? Number.parseFloat(v) : v.endsWith('s') ? Number.parseFloat(v) * 1000 : 0;
    };
    return Math.max(ms(s.animationDuration), 0) + ms(s.animationDelay);
  };
  document.addEventListener(
    'animationstart',
    (e) => {
      w.__motion.push({
        kind: 'animation',
        name: e.animationName,
        where: where(e.target, e.pseudoElement),
        step: w.__motionStep,
        endTime:
          endOf(e.target, (a) => a instanceof CSSAnimation && a.animationName === e.animationName) ??
          computedEnd(e.target, e.pseudoElement, e.animationName),
      });
    },
    true,
  );
}

/**
 * Runs in the page: reads the motion properties of every element and pseudo-element and returns each one that allows
 * a combined duration above 0, plus how many elements were read.
 */
function scanStatic(): { hits: StaticHit[]; elements: number } {
  const seconds = (value: string): number[] =>
    value.split(',').map((part) => {
      const v = part.trim();
      if (v.endsWith('ms')) return Number.parseFloat(v) / 1000;
      if (v.endsWith('s')) return Number.parseFloat(v);
      return 0; // `auto` (animation-duration) is 0 for CSS animations
    });
  /** Per list index, duration + delay (the shorter list repeats, as the cascade does). */
  const combined = (durations: string, delays: string): number[] => {
    const d = seconds(durations);
    const l = seconds(delays);
    const n = Math.max(d.length, l.length);
    return Array.from({ length: n }, (_, i) => Math.max(d[i % d.length] ?? 0, 0) + (l[i % l.length] ?? 0));
  };
  const hits: StaticHit[] = [];
  const elements = [...document.querySelectorAll('*')];
  for (const el of elements) {
    const owner = el.closest('[data-gallery]')?.getAttribute('data-gallery') ?? '(no data-gallery)';
    const classes = [...el.classList].filter((c) => !c.startsWith('ng-')).join('.');
    const pseudos = el instanceof HTMLDialogElement ? [null, '::before', '::after', '::backdrop'] : [null, '::before', '::after'];
    for (const pseudo of pseudos) {
      const s = getComputedStyle(el, pseudo);
      if (pseudo !== null && pseudo !== '::backdrop' && (s.content === 'none' || s.content === 'normal')) continue;
      const where = `${owner} > ${el.tagName.toLowerCase()}${classes ? `.${classes}` : ''}${pseudo ?? ''}`;
      if (s.transitionProperty !== 'none') {
        const times = combined(s.transitionDuration, s.transitionDelay);
        if (times.some((t) => t > 0)) {
          hits.push({
            where,
            property: 'transition',
            value: `${s.transitionProperty} / duration ${s.transitionDuration} / delay ${s.transitionDelay}`,
          });
        }
      }
      if (s.animationName !== 'none') {
        const times = combined(s.animationDuration, s.animationDelay);
        if (times.some((t) => t > 0)) {
          hits.push({
            where,
            property: 'animation',
            value: `${s.animationName} / duration ${s.animationDuration} / delay ${s.animationDelay} / iterations ${s.animationIterationCount}`,
          });
        }
      }
    }
  }
  return { hits, elements: elements.length };
}

/**
 * Runs in the page after two animation frames (so a transition triggered by the last input has been created):
 * every animation on the document with a computed end time above 0, the animations still on the moved element, and
 * everything the recorder saw since the last call (drained).
 */
async function snapshot(selector: string | null): Promise<{ running: string[]; onTarget: string[]; recorded: Recorded[] }> {
  const frames = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  // A new animation is pending until the next frame commits, and its `animationstart` fires a frame after that.
  await frames();
  await Promise.all(document.getAnimations().map((a) => a.ready.catch(() => undefined)));
  await frames();
  const describe = (a: Animation): string => {
    const effect = a.effect as KeyframeEffect | null;
    const target = effect?.target ?? null;
    const owner = target?.closest('[data-gallery]')?.getAttribute('data-gallery') ?? '(no data-gallery)';
    const name =
      a instanceof CSSTransition ? `transition ${a.transitionProperty}` : a instanceof CSSAnimation ? `animation ${a.animationName}` : 'animation (script)';
    const timing = effect?.getComputedTiming();
    return `${owner} > ${target?.tagName.toLowerCase() ?? '?'}${effect?.pseudoElement ?? ''}: ${name}, duration ${String(effect?.getTiming().duration)}, active ${String(timing?.activeDuration)}, end ${String(timing?.endTime)}`;
  };
  const moving = (a: Animation): boolean => {
    const timing = a.effect?.getComputedTiming();
    const duration = a.effect?.getTiming().duration;
    return (typeof duration === 'number' && duration > 0) || Number(timing?.activeDuration ?? 0) > 0 || Number(timing?.endTime ?? 0) > 0;
  };
  const running = document.getAnimations().filter(moving).map(describe);
  const target = selector === null ? null : document.querySelector(selector);
  const onTarget = target ? target.getAnimations({ subtree: true }).map(describe) : [];
  const w = window as unknown as { __motion: Recorded[] };
  const recorded = w.__motion.splice(0);
  return { running, onTarget, recorded };
}

type Step = { name: string; target: string; act: (page: Page) => Promise<void> };

const g = (name: string): string => `[data-gallery="${name}"]`;
const hover = (name: string): Step => ({
  name: `hover ${name}`,
  target: g(name),
  act: async (page) => {
    await page.locator(g(name)).hover();
  },
});
/** The interactions the primitives animate (design.md § Motion tokens), in an order that leaves the page usable. */
const STEPS: readonly Step[] = [
  ...['button-primary', 'button-secondary', 'button-ghost', 'button-outline', 'button-primary-danger', 'button-link'].map(hover),
  hover('icon-button'),
  hover('card-interactive'),
  hover('kpi-tile-link'),
  {
    name: 'mouse leaves',
    target: 'body',
    act: async (page) => {
      await page.mouse.move(0, 0);
    },
  },
  {
    name: 'focus and press a filter chip',
    target: g('filter-chips'),
    act: async (page) => {
      const chips = page.locator(`${g('filter-chips')} button`);
      await chips.nth(1).focus();
      await page.keyboard.press('Enter');
      await chips.nth(0).click();
    },
  },
  {
    name: 'change the segmented value',
    target: g('segmented'),
    act: async (page) => {
      await page.locator(`${g('segmented')} [role="radio"]`).nth(1).click();
      await page.keyboard.press('ArrowRight');
    },
  },
  {
    name: 'open disclosure-closed',
    target: g('disclosure-closed'),
    act: async (page) => {
      await page.locator(`${g('disclosure-closed')} button.summary`).click();
      await expect(page.locator(g('disclosure-closed'))).toHaveAttribute('data-open', '');
    },
  },
  {
    name: 'close disclosure-closed',
    target: g('disclosure-closed'),
    act: async (page) => {
      await page.locator(`${g('disclosure-closed')} button.summary`).click();
      await expect(page.locator(g('disclosure-closed'))).not.toHaveAttribute('data-open');
    },
  },
  {
    name: 'close and reopen disclosure-open',
    target: g('disclosure-open'),
    act: async (page) => {
      const summary = page.locator(`${g('disclosure-open')} button.summary`);
      await summary.click();
      await summary.click();
    },
  },
  {
    name: 'close the popover (Esc)',
    target: g('popover'),
    act: async (page) => {
      await page.locator(`${g('popover')} [popover]`).evaluate((el) => {
        el.focus();
      });
      await page.keyboard.press('Escape');
      await expect(page.locator(`${g('popover')} [popover]`)).toBeHidden();
    },
  },
  {
    name: 'open the popover (trigger)',
    target: g('popover'),
    act: async (page) => {
      await page.locator(g('popover-trigger')).click();
      await expect(page.locator(`${g('popover')} [popover]`)).toBeVisible();
    },
  },
  {
    name: 'dismiss the popover',
    target: g('popover'),
    act: async (page) => {
      await page.keyboard.press('Escape');
      await expect(page.locator(`${g('popover')} [popover]`)).toBeHidden();
    },
  },
  {
    name: 'open the dialog',
    target: `${g('dialog')} dialog`,
    act: async (page) => {
      await page.locator(g('dialog-trigger')).click();
      await expect(page.locator(`${g('dialog')} dialog`)).toBeVisible();
    },
  },
  {
    name: 'close the dialog',
    target: `${g('dialog')} dialog`,
    act: async (page) => {
      await page.locator(g('dialog-action')).click();
      await expect(page.locator(`${g('dialog')} dialog`)).toBeHidden();
    },
  },
  {
    name: 'open the sheet',
    target: `${g('sheet')} dialog`,
    act: async (page) => {
      await page.locator(g('sheet-trigger')).click();
      await expect(page.locator(`${g('sheet')} dialog`)).toBeVisible();
    },
  },
  {
    name: 'close the sheet',
    target: `${g('sheet')} dialog`,
    act: async (page) => {
      await page.locator(g('sheet-action')).click();
      await expect(page.locator(`${g('sheet')} dialog`)).toBeHidden();
    },
  },
  {
    name: 'restart the skeleton sweep',
    target: g('skeleton'),
    act: async (page) => {
      // Taking the box out of rendering and back cancels and restarts its CSS animation.
      await page.locator(g('skeleton')).evaluate((el) => {
        const box = el as HTMLElement;
        box.style.display = 'none';
        box.getBoundingClientRect(); // flush style, so the animation is cancelled before it comes back
        box.style.display = '';
      });
    },
  },
];

/** Opens the gallery under `preference` in `theme` with the recorder in place and proves the preference arrived. */
async function open(page: Page, theme: Theme, preference: Preference): Promise<void> {
  await page.emulateMedia({ reducedMotion: preference });
  await page.addInitScript(installRecorder);
  await page.goto(`/__ui?theme=${theme}`);
  await awaitReady(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', `spec-${theme}`);
  await expect(page.locator('[data-ui="gallery"]')).toBeVisible();
  const reduced = await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  expect(reduced, 'prefers-reduced-motion as the page sees it').toBe(preference === 'reduce');
  expect(await page.locator('[data-gallery]').count(), 'primitives in the gallery').toBeGreaterThanOrEqual(MIN_GALLERY);
}

/** Drives every step and returns what each one set in motion, keyed `step: finding`. */
async function drive(page: Page): Promise<{ failures: string[]; recorded: Recorded[]; statics: number }> {
  const failures: string[] = [];
  const recorded: Recorded[] = [];
  let statics = 0;
  const judge = (step: string, snap: Awaited<ReturnType<typeof snapshot>>): void => {
    for (const r of snap.running) failures.push(`${step}: running ${r}`);
    for (const r of snap.onTarget) failures.push(`${step}: still on the moved element ${r}`);
    for (const r of snap.recorded) {
      recorded.push(r);
      // A transition exists only at a combined duration above 0; a 0 ms animation starts and ends at once.
      if (r.kind === 'transition' || (r.endTime ?? 0) > 0) {
        failures.push(`${step}: ${r.kind} ${r.name} ran on ${r.where} (end ${String(r.endTime)})`);
      }
    }
  };

  const rest = await page.evaluate(scanStatic);
  expect(rest.elements, 'elements read at rest').toBeGreaterThanOrEqual(MIN_ELEMENTS);
  for (const hit of rest.hits) failures.push(`at rest: ${hit.where}: ${hit.property} ${hit.value}`);
  statics += rest.hits.length;
  judge('load', await page.evaluate(snapshot, null));

  for (const step of STEPS) {
    await page.evaluate((name) => {
      (window as unknown as { __motionStep: string }).__motionStep = name;
    }, step.name);
    await step.act(page);
    judge(step.name, await page.evaluate(snapshot, step.target));
    const after = await page.evaluate(scanStatic);
    for (const hit of after.hits) failures.push(`${step.name}: ${hit.where}: ${hit.property} ${hit.value}`);
    statics += after.hits.length;
  }
  return { failures: [...new Set(failures)], recorded, statics };
}

test.describe('motion', () => {
  for (const theme of ['light', 'dark'] as const) {
    test(`no animation or transition runs under reduced motion · ${theme}`, async ({ page }) => {
      await open(page, theme, 'reduce');
      const { failures, recorded } = await drive(page);
      test.info().annotations.push({
        type: 'motion',
        description: `${theme}, reduce: ${String(STEPS.length)} interactions, ${String(recorded.length)} events recorded, ${String(failures.length)} failures`,
      });
      expect(failures, `motion under prefers-reduced-motion: reduce (${theme}):\n${failures.join('\n')}`).toEqual([]);
    });

    test(`control: motion runs without the preference · ${theme}`, async ({ page }) => {
      await open(page, theme, 'no-preference');
      const { recorded, statics } = await drive(page);
      const transitions = recorded.filter((r) => r.kind === 'transition');
      const onDisclosure = transitions.filter((r) => r.step.includes('disclosure'));
      const onHover = transitions.filter((r) => r.step.startsWith('hover button'));
      const sweep = recorded.filter((r) => r.step === 'restart the skeleton sweep' && r.kind === 'animation' && (r.endTime ?? 0) > 0);
      test.info().annotations.push({
        type: 'motion',
        description: `${theme}, no-preference: ${String(transitions.length)} transitions (${String(onDisclosure.length)} disclosure, ${String(onHover.length)} button hover), ${String(sweep.length)} skeleton restarts, ${String(statics)} non-zero durations in computed style`,
      });
      expect(statics, 'elements whose computed style allows motion without the preference').toBeGreaterThan(0);
      expect(onDisclosure.length, 'transitions on the disclosure without the preference').toBeGreaterThan(0);
      expect(onHover.length, 'transitions on a button hover without the preference').toBeGreaterThan(0);
      expect(sweep.length, 'the restarted skeleton sweep without the preference').toBeGreaterThan(0);
    });
  }
});
