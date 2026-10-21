/**
 * Step counter and Keystroke-Level-Model estimate for usage paths (spec 019 T5, ISC-139.1; the notation of spec 018).
 *
 *   const steps = new StepCounter(page);
 *   await steps.press('ControlOrMeta+k', 'palette');   // a chord is one step
 *   await steps.type('126');                           // one step per character
 *   await steps.press('Enter');
 *   steps.count;              // 5
 *   klm(steps.sequence);      // 4.1 (seconds)
 *
 * Counting (spec 018 § Notation): a click or tap is one step, so is every key press and every chord (`⌘K` counts
 * one); a typed term counts one step per character; scrolling one screen is one step; reading is not a step. Every
 * interaction of a path goes through the counter, so a step the path takes cannot go uncounted. `click` and `tap`
 * first assert the target is wholly in the viewport: Playwright would otherwise scroll it into view and hide the
 * scroll steps a person needs.
 *
 * Time (KLM, the operator values of spec 018): M 1.35 s mental preparation, P 1.1 s point, B 0.2 s button press,
 * K 0.28 s key, H 0.4 s homing between mouse and keyboard; one screen of scrolling is K + M.
 *
 * How M and H are placed — calibrated so the sum reproduces the Ist times spec 018 measured (P1: three clicks and
 * the seven keys of "ISC-126" = 11.66 s ≈ 11.7 s; P3: one click and three screens = 7.54 s ≈ 7.5 s):
 * - One M per step group, not per step. A group is one click or tap, one key press or chord, one scrolled screen,
 *   or one typed term. Typing "126" is one group: M + 3K.
 * - An Enter right after a typed term terminates that term and joins its group without a second M (Card, Moran and
 *   Newell's KLM heuristic for a delimiter at the end of a cognitive unit): "126" then Enter is M + 4K.
 * - A click or tap costs P + B, a key, chord or typed character K, a scrolled screen K (plus its group's M).
 * - H is added whenever a step needs the other device than the step before it (mouse ↔ keyboard). The hand starts
 *   where the first step needs it, so no H precedes the first step. A tap counts as the mouse, typing on an on-screen
 *   keyboard as the keyboard (spec 018 timed P1 at 390 px the same as at 1440 px). Scrolling is device-neutral: it
 *   neither costs nor resets H (P3's 7.54 s has none).
 */
import { expect, type Locator, type Page } from '@playwright/test';

/** KLM operator times in seconds (spec 018 § Notation). */
export const KLM = { M: 1.35, P: 1.1, B: 0.2, K: 0.28, H: 0.4 } as const;

export type StepKind = 'click' | 'key' | 'char' | 'scroll';
type Device = 'mouse' | 'keyboard' | null;

export interface Step {
  readonly kind: StepKind;
  /** What the step did, for the evidence line: `click 007`, `Meta+K`, `6`, `scroll`. */
  readonly label: string;
  /** Steps with the same group share one M. */
  readonly group: number;
}

const DEVICE: Readonly<Record<StepKind, Device>> = { click: 'mouse', key: 'keyboard', char: 'keyboard', scroll: null };
const COST: Readonly<Record<StepKind, number>> = { click: KLM.P + KLM.B, key: KLM.K, char: KLM.K, scroll: KLM.K };

/** The pure sequence builder: what each interaction counts as, without a page. The self-test drives it directly. */
export class StepRecorder {
  private readonly steps: Step[] = [];
  private nextGroup = 0;

  get sequence(): readonly Step[] {
    return this.steps;
  }

  get count(): number {
    return this.steps.length;
  }

  click(label: string): void {
    this.push('click', label, this.nextGroup++);
  }

  /** One key or one chord (`Meta+K`), shown as `label`. An Enter (also the on-screen Go key) right after a typed term joins that term's group. */
  key(key: string, label: string = key): void {
    const last = this.steps.at(-1);
    const terminates = key === 'Enter' && last?.kind === 'char';
    this.push('key', label, terminates ? last.group : this.nextGroup++);
  }

  /** A typed term: one step per character, one group. */
  chars(text: string): void {
    const group = this.nextGroup++;
    for (const ch of text) this.push('char', ch, group);
  }

  scroll(): void {
    this.push('scroll', 'scroll', this.nextGroup++);
  }

  private push(kind: StepKind, label: string, group: number): void {
    this.steps.push({ kind, label, group });
  }
}

/** The KLM estimate of a sequence in seconds, rounded to the hundredth (rules in the file header). */
export function klm(sequence: readonly Step[]): number {
  let seconds = 0;
  let hand: Device = null;
  let group: number | null = null;
  for (const step of sequence) {
    if (step.group !== group) seconds += KLM.M;
    group = step.group;
    const device = DEVICE[step.kind];
    if (device !== null) {
      if (hand !== null && hand !== device) seconds += KLM.H;
      hand = device;
    }
    seconds += COST[step.kind];
  }
  return Math.round(seconds * 100) / 100;
}

/** `Meta+K · 1 · 2 · 6 · Enter`: the sequence as one evidence line. */
export function trail(sequence: readonly Step[]): string {
  return sequence.map((s) => s.label).join(' · ');
}

/** Wraps the page interactions a path uses; each one is counted before it is performed. */
export class StepCounter extends StepRecorder {
  constructor(private readonly page: Page) {
    super();
  }

  /** A mouse click on a target that is already wholly on screen. */
  async clickOn(target: Locator, label: string): Promise<void> {
    await expect(target).toBeInViewport({ ratio: 1 });
    this.click(label);
    await target.click();
  }

  /** A tap (needs `hasTouch`) on a target that is already wholly on screen; it counts like a click. */
  async tapOn(target: Locator, label: string): Promise<void> {
    await expect(target).toBeInViewport({ ratio: 1 });
    this.click(label);
    await target.tap();
  }

  /**
   * A tap that stands in for a chord: the touch trigger of the palette (the search button) counts like `⌘K`, as a key
   * step and K for time, with no mouse-to-keyboard switch (principal, 2026-10-12, spec 019 ISC-139.1).
   */
  async tapAsChord(target: Locator, label: string): Promise<void> {
    await expect(target).toBeInViewport({ ratio: 1 });
    this.key(label, label);
    await target.tap();
  }

  /** One key press or chord into the focused element (`ControlOrMeta+k`, `Enter`). */
  async press(key: string, label: string = key): Promise<void> {
    this.key(key, label);
    await this.page.keyboard.press(key);
  }

  /** Types `text` into the focused element, one key per character. */
  async type(text: string): Promise<void> {
    this.chars(text);
    for (const ch of text) await this.page.keyboard.type(ch);
  }

  /** Scrolls the page down by one screen, as Page Down does (seven eighths of the viewport height). */
  async scrollScreen(): Promise<void> {
    const viewport = this.page.viewportSize();
    if (!viewport) throw new Error('scrollScreen needs a fixed viewport');
    this.scroll();
    const before = await this.page.evaluate(() => window.scrollY);
    await this.page.mouse.move(viewport.width / 2, viewport.height / 2);
    await this.page.mouse.wheel(0, Math.round(viewport.height * 0.875));
    await expect.poll(() => this.page.evaluate(() => window.scrollY)).toBeGreaterThan(before);
  }

  /**
   * Scrolls just far enough to bring `target` wholly on screen and counts it as one scroll step, the same as a screen:
   * a partial scroll is still one scroll action in the 018 notation. Use it only where the target is not yet wholly in
   * view (spec 024: the tab bar under the header moved the claims list down at 390).
   */
  async scrollTo(target: Locator): Promise<void> {
    this.scroll();
    await target.scrollIntoViewIfNeeded();
    await expect(target).toBeInViewport({ ratio: 1 });
  }
}
