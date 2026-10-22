import { CATALOGUES, LANGS } from '../../../i18n/catalogues';
import { STAGE_ORDER, STAGE_TONE, toneOfStage } from './stage-tone';

describe('stage-tone (spec 064, ISC-500)', () => {
  it('lists the stages in workflow order, as core counts them', () => {
    expect(STAGE_ORDER).toEqual(['plan', 'tasks', 'review', 'build', 'blocked', 'code-review', 'close-pending', 'close', 'done']);
  });

  it('gives every stage the tone design.md names, mapped onto the shared tones', () => {
    expect(STAGE_TONE).toEqual({
      plan: 'secondary',
      tasks: 'secondary',
      review: 'concern',
      build: 'primary',
      blocked: 'error',
      'code-review': 'warning',
      'close-pending': 'concern',
      close: 'warning',
      done: 'success',
    });
    for (const stage of STAGE_ORDER) expect(toneOfStage(stage), stage).toBe(STAGE_TONE[stage]);
  });

  it('tones a stage it does not know neutral, never a phase tone', () => {
    for (const word of ['idea', 'scoping', 'building', 'complete', '']) expect(toneOfStage(word), word).toBe('neutral');
  });

  for (const lang of LANGS) {
    it(`names every stage in the ${lang} catalogue`, () => {
      const stages = (CATALOGUES[lang] as unknown as { stages: Record<string, string> }).stages;
      for (const stage of STAGE_ORDER) expect(stages[stage], `${lang} stages.${stage}`).toBeTruthy();
    });
  }
});
