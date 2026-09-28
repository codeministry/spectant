import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { UiIdChip } from './id-chip';

@Component({ imports: [UiIdChip], template: `<ui-id-chip>012</ui-id-chip>` })
class Host {}

describe('UiIdChip', () => {
  it('projects the ID text', async () => {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).querySelector('ui-id-chip')?.textContent).toBe('012');
  });
});
