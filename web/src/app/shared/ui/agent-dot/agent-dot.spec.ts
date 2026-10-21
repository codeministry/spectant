import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { UiAgentDot } from './agent-dot';

@Component({ imports: [UiAgentDot], template: `<ui-agent-dot [label]="label()" />` })
class Host {
  readonly label = signal<string | null>(null);
}

async function render(label: string | null): Promise<HTMLElement> {
  const fixture = TestBed.createComponent(Host);
  fixture.componentInstance.label.set(label);
  await fixture.whenStable();
  return (fixture.nativeElement as HTMLElement).querySelector('ui-agent-dot') as HTMLElement;
}

describe('UiAgentDot', () => {
  it('with a label the dot is an image named by it', async () => {
    const dot = await render('Agent a:claude:sess-2 works');
    expect(dot.getAttribute('role')).toBe('img');
    expect(dot.getAttribute('aria-label')).toBe('Agent a:claude:sess-2 works');
    expect(dot.hasAttribute('aria-hidden')).toBe(false);
  });

  it('without a label the dot is hidden from assistive technology', async () => {
    const dot = await render(null);
    expect(dot.getAttribute('aria-hidden')).toBe('true');
    expect(dot.hasAttribute('role')).toBe(false);
    expect(dot.hasAttribute('aria-label')).toBe(false);
  });

  it('draws the ping ring as its own element inside the dot', async () => {
    const dot = await render(null);
    expect(dot.querySelector('.ring')).not.toBeNull();
  });
});
