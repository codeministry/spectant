import { TestBed } from '@angular/core/testing';
import { DEMO_ASSISTANT_FALLBACK } from './fixtures/assistant';
import { DemoData } from './demo-data';

describe('DemoData', () => {
  it('hands out the fixtures synchronously as read-only signals (ISC-149.1)', () => {
    const demo = TestBed.inject(DemoData);

    expect(demo.assistantSuggestions().length).toBeGreaterThan(0);
    expect(Object.isFrozen(demo.assistantSuggestions())).toBe(true);
    expect('set' in demo.assistantSuggestions).toBe(false);
  });

  it('answers a known suggestion from the fixture and anything else with the fallback', () => {
    const demo = TestBed.inject(DemoData);
    const [first] = demo.assistantSuggestions();

    expect(demo.assistantReply(` ${first.prompt.toUpperCase()} `)).toBe(first.reply);
    expect(demo.assistantReply('anything else')).toBe(DEMO_ASSISTANT_FALLBACK);
  });
});
