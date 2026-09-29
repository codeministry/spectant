import { quoteIdea, stageIndex } from './dashboard-model';

describe('quoteIdea', () => {
  it('wraps English in curly double quotes', () => {
    expect(quoteIdea('A teammate opens the console.', 'en')).toBe('“A teammate opens the console.”');
  });

  it('wraps German in low-high quotes', () => {
    expect(quoteIdea('Ein Satz.', 'de')).toBe('„Ein Satz.“');
  });

  it('reads a regional tag by its language and falls back to English', () => {
    expect(quoteIdea('x', 'de-AT')).toBe('„x“');
    expect(quoteIdea('x', 'fr')).toBe('“x”');
  });

  it('does not double the quotes a source already carries', () => {
    expect(quoteIdea('"Quoted."', 'en')).toBe('“Quoted.”');
    expect(quoteIdea('“Quoted.”', 'de')).toBe('„Quoted.“');
  });
});

describe('stageIndex', () => {
  it('maps the five-segment track', () => {
    expect(['plan', 'tasks', 'review', 'build', 'close'].map(stageIndex)).toEqual([0, 1, 2, 3, 4]);
  });

  it('puts blocked on build, code review on close and done past the end', () => {
    expect(stageIndex('blocked')).toBe(3);
    expect(stageIndex('code-review')).toBe(4);
    expect(stageIndex('done')).toBe(5);
    expect(stageIndex('unknown')).toBe(0);
  });
});
