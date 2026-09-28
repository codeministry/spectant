import { TestBed } from '@angular/core/testing';
import { UiStageTrack } from './stage-track';

const LABELS = ['Plan', 'Tasks', 'Review', 'Build', 'Close'];

describe('UiStageTrack', () => {
  it('names the mini track and marks done, current and pending segments', async () => {
    const fixture = TestBed.createComponent(UiStageTrack);
    fixture.componentRef.setInput('labels', LABELS);
    fixture.componentRef.setInput('current', 3);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('Stage 4 of 5: Build');
    expect([...host.querySelectorAll('.bar')].map((b) => b.getAttribute('data-state'))).toEqual([
      'done', 'done', 'done', 'current', 'pending',
    ]);
  });

  it('labels each step and marks the current one as the step', async () => {
    const fixture = TestBed.createComponent(UiStageTrack);
    fixture.componentRef.setInput('labels', LABELS);
    fixture.componentRef.setInput('current', 1);
    fixture.componentRef.setInput('size', 'labelled');
    await fixture.whenStable();
    const current = (fixture.nativeElement as HTMLElement).querySelector('li[aria-current="step"]');
    expect(current?.textContent.trim()).toBe('Tasks');
  });
});
