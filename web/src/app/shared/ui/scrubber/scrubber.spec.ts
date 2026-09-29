import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { CATALOGUES, LANGS } from '../../../../i18n/catalogues';
import { type ScrubberFrame, UiScrubber } from './scrubber';

// The range's own layout and the 400 ms fill morph are real-browser concerns (motion tokens are 0ms under reduced
// motion, motion.css). Here: the range contract, the keyboard, the step buttons and the tick kinds.

const FRAMES: ScrubberFrame[] = [
  { kind: 'dispatch', label: 'Dispatch 1' },
  { kind: 'result', label: 'R1', tone: 'success' },
  { kind: 'recut', label: 'Re-cut' },
  { kind: 'result', label: 'R2', tone: 'error' },
  { kind: 'live', label: 'Live' },
];

@Component({
  imports: [UiScrubber],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<ui-scrubber [frames]="frames" [(value)]="value" [(playing)]="playing" />`,
})
class Host {
  readonly frames = FRAMES;
  readonly value = signal(1);
  readonly playing = signal(false);
}

async function render() {
  TestBed.configureTestingModule({
    imports: [
      TranslocoTestingModule.forRoot({
        langs: CATALOGUES,
        translocoConfig: { availableLangs: [...LANGS], defaultLang: 'en' },
        preloadLangs: true,
      }),
    ],
  });
  const fixture = TestBed.createComponent(Host);
  await fixture.whenStable();
  const root = fixture.nativeElement as HTMLElement;
  const range = root.querySelector<HTMLInputElement>('input[type="range"]');
  if (!range) throw new Error('range missing');
  const key = async (name: string) => {
    range.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));
    await fixture.whenStable();
  };
  const step = (which: string) => root.querySelector<HTMLButtonElement>(`button[data-step="${which}"]`);
  return { fixture, root, range, key, step, host: fixture.componentInstance };
}

describe('UiScrubber', () => {
  it('is a real range over the frames, named by the frame label in aria-valuetext', async () => {
    const { range } = await render();

    expect(range.min).toBe('0');
    expect(range.max).toBe('4');
    expect(range.value).toBe('1');
    expect(range.getAttribute('aria-valuetext')).toBe('R1');
    expect(range.getAttribute('aria-label')).toBe('Frame');
  });

  it('moves and emits on arrow keys, Home and End, clamped to the frames', async () => {
    const { range, key, host } = await render();

    await key('ArrowRight');
    expect(host.value()).toBe(2);
    expect(range.getAttribute('aria-valuetext')).toBe('Re-cut');

    await key('ArrowLeft');
    await key('ArrowDown');
    expect(host.value()).toBe(0);
    await key('ArrowLeft');
    expect(host.value()).toBe(0);

    await key('End');
    expect(host.value()).toBe(4);
    expect(range.getAttribute('aria-valuetext')).toBe('Live');
    await key('ArrowUp');
    expect(host.value()).toBe(4);
    await key('Home');
    expect(host.value()).toBe(0);
  });

  it('follows native input and steps with the 32 px buttons, which carry translated names', async () => {
    const { fixture, range, step, host } = await render();

    range.value = '3';
    range.dispatchEvent(new Event('input', { bubbles: true }));
    await fixture.whenStable();
    expect(host.value()).toBe(3);

    step('next')?.click();
    await fixture.whenStable();
    expect(host.value()).toBe(4);
    expect(step('next')?.disabled).toBe(true);

    step('previous')?.click();
    await fixture.whenStable();
    expect(host.value()).toBe(3);
    expect(step('previous')?.getAttribute('aria-label')).toBe('Previous frame');

    step('play')?.click();
    await fixture.whenStable();
    expect(host.playing()).toBe(true);
    expect(step('play')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('draws one tick per frame by kind, results in the tone mark', async () => {
    const { root } = await render();
    const ticks = [...root.querySelectorAll<HTMLElement>('.tick')];

    expect(ticks.map((t) => t.dataset['kind'])).toEqual(['dispatch', 'result', 'recut', 'result', 'live']);
    expect(ticks[3]?.style.getPropertyValue('--tick-color')).toBe('var(--color-error)');
    expect(ticks[1]?.hasAttribute('data-current')).toBe(true);
    expect(root.querySelector('.ticks')?.getAttribute('aria-hidden')).toBe('true');
  });
});
