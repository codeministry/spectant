import { TestBed } from '@angular/core/testing';
import { UiChip } from './chip';

describe('UiChip', () => {
  it('takes its tint and ink from the tone and shows a dot on request', async () => {
    const fixture = TestBed.createComponent(UiChip);
    fixture.componentRef.setInput('tone', 'secondary');
    fixture.componentRef.setInput('dot', true);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.style.getPropertyValue('--chip-tint')).toBe('var(--ques-t)');
    expect(host.style.getPropertyValue('--chip-ink')).toBe('var(--ques-ink)');
    expect(host.querySelector('.dot')).not.toBeNull();
  });
});
