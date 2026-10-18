import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { type Translation, TranslocoService, TranslocoTestingModule } from '@jsverse/transloco';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GuidanceReason } from '../../../../../../core/src/files';
import { GuidanceReasonPipe } from './guidance-reason.pipe';

// T11 · ISC-237.1: the reason key of a guidance entry becomes one sentence of the active catalogue, filled with the
// key's values; an unknown key shows the core's phrase unchanged and warns once. The catalogue here is a minimal test
// one, so the pipe is proven apart from the real sentences (T10). It holds both catalogue shapes: the key's dots as
// nesting (`stage.review.0`) and as one literal key (`waiting.manual`); transloco flattens both to the same path.
const LANGS: Record<'en' | 'de', Translation> = {
  en: {
    guidance: {
      reason: {
        stage: { review: { '0': 'Review the spec: its reviewed mark is {{state}}.' } },
        'waiting.manual': 'Confirm {{ref}} by hand, the build cannot check it.',
      },
    },
  },
  de: {
    guidance: {
      reason: {
        stage: { review: { '0': 'Prüfen Sie die Spec: Ihr Review ist {{state}}.' } },
        'waiting.manual': 'Bestätigen Sie {{ref}} von Hand, der Build kann es nicht prüfen.',
      },
      value: { state: { stale: 'veraltet' } },
    },
  },
};

@Component({
  selector: 'app-test-host',
  imports: [GuidanceReasonPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<p>{{ reason() | guidanceReason }}</p>`,
})
class Host {
  readonly reason = input.required<GuidanceReason>();
}

async function render(reason: GuidanceReason) {
  TestBed.configureTestingModule({
    imports: [
      TranslocoTestingModule.forRoot({
        langs: LANGS,
        translocoConfig: { availableLangs: ['en', 'de'], defaultLang: 'en', reRenderOnLangChange: true },
        preloadLangs: true,
      }),
    ],
  });
  const fixture = TestBed.createComponent(Host);
  fixture.componentRef.setInput('reason', reason);
  await fixture.whenStable();
  return fixture;
}

const text = (fixture: { nativeElement: unknown }): string =>
  ((fixture.nativeElement as HTMLElement).querySelector('p')?.textContent ?? '').trim();

afterEach(() => vi.restoreAllMocks());

describe('guidanceReason pipe (T11, ISC-237.1)', () => {
  it('fills a nested key with its values', async () => {
    const fixture = await render({ key: 'stage.review.0', values: { state: 'missing' }, phrase: 'the reviewed mark is missing' });

    expect(text(fixture)).toBe('Review the spec: its reviewed mark is missing.');
  });

  it('fills a key the catalogue holds with its dots as one literal key', async () => {
    const fixture = await render({ key: 'waiting.manual', values: { ref: 'ISC-7' }, phrase: 'ISC-7 needs your confirmation' });

    expect(text(fixture)).toBe('Confirm ISC-7 by hand, the build cannot check it.');
  });

  it('re-renders in the new language when the language switches, a value in its catalogue word', async () => {
    const fixture = await render({ key: 'stage.review.0', values: { state: 'stale' }, phrase: 'the reviewed mark is stale' });
    expect(text(fixture)).toBe('Review the spec: its reviewed mark is stale.');

    TestBed.inject(TranslocoService).setActiveLang('de');
    await fixture.whenStable();

    expect(text(fixture)).toBe('Prüfen Sie die Spec: Ihr Review ist veraltet.');
  });

  it('shows the phrase unchanged for a key the catalogue lacks and warns once per key', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const phrase = 'a phrase no template matches';
    const fixture = await render({ key: 'stage.unknown.9', values: {}, phrase });

    expect(text(fixture)).toBe(phrase);
    fixture.componentRef.setInput('reason', { key: 'stage.unknown.9', values: {}, phrase: `${phrase}, again` });
    await fixture.whenStable();
    TestBed.inject(TranslocoService).setActiveLang('de');
    await fixture.whenStable();

    expect(text(fixture)).toBe(`${phrase}, again`);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('stage.unknown.9');
  });

  it('shows the phrase unchanged for the key `phrase` and warns once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fixture = await render({ key: 'phrase', values: {}, phrase: 'plan.md is missing for this spec' });

    expect(text(fixture)).toBe('plan.md is missing for this spec');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('phrase');
  });
});
