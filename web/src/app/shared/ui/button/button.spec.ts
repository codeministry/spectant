import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { UiButton } from './button';
import { UiButtonGroup } from './button-group';
import { UiIconButton } from './icon-button';

// Class and attribute contracts only. Layout, the coarse-pointer hit area and the focus ring are measured on real
// Chromium by the browser spec (T29, `bun run test:browser -- focus`); jsdom has no layout and no cascade.

@Component({
  imports: [UiButton, UiIconButton, UiButtonGroup],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button ui-button id="default">Default</button>
    <button ui-button id="primary" variant="primary" size="sm">Primary</button>
    <button ui-button id="ghost" variant="ghost">Ghost</button>
    <a ui-button id="outline" variant="outline" href="#x">Outline</a>
    <button ui-button id="danger" variant="primary" tone="danger">Delete</button>
    <button ui-button id="disabled" disabled (click)="clicks.set(clicks() + 1)">Disabled</button>
    <a ui-button id="disabled-link" [disabled]="true" href="#x">Link</a>
    <button ui-icon-button id="icon" icon="settings" label="Settings" size="sm"></button>
    <ui-button-group id="joined" label="View">
      <button ui-icon-button icon="table" label="Table"></button>
      <button ui-icon-button icon="layers" label="Layers"></button>
    </ui-button-group>
    <ui-button-group id="spaced" gap>
      <button ui-button>One</button>
    </ui-button-group>
  `,
})
class Host {
  readonly clicks = signal(0);
}

async function render(): Promise<{ el: (id: string) => HTMLElement; host: Host }> {
  const fixture = TestBed.createComponent(Host);
  await fixture.whenStable();
  const root = fixture.nativeElement as HTMLElement;
  return {
    host: fixture.componentInstance,
    el: (id) => root.querySelector<HTMLElement>(`#${id}`) ?? (() => { throw new Error(`#${id} missing`); })(),
  };
}

describe('UiButton', () => {
  it('builds each variant and size on the daisyUI btn classes', async () => {
    const { el } = await render();

    expect(el('default').classList).toContain('btn');
    expect(el('default').classList).toContain('btn-md');
    expect(el('default').dataset['variant']).toBe('secondary');
    expect(el('default').getAttribute('type')).toBe('button');
    expect(el('primary').classList).toContain('btn-primary');
    expect(el('primary').classList).toContain('btn-sm');
    expect(el('ghost').classList).toContain('btn-ghost');
    expect(el('outline').classList).toContain('btn-outline');
    expect(el('outline').getAttribute('type')).toBeNull();
    expect(el('danger').classList).toContain('btn-error');
    expect(el('danger').dataset['tone']).toBe('danger');
  });

  it('marks disabled with aria-disabled, stays focusable and swallows activation', async () => {
    const { el, host } = await render();
    const button = el('disabled');

    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.hasAttribute('disabled')).toBe(false);
    button.click();
    expect(host.clicks()).toBe(0);

    const link = el('disabled-link');
    expect(link.getAttribute('aria-disabled')).toBe('true');
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    link.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
  });
});

describe('UiIconButton', () => {
  it('exposes the label as aria-label and title and renders the icon', async () => {
    const { el } = await render();
    const button = el('icon');

    expect(button.getAttribute('aria-label')).toBe('Settings');
    expect(button.getAttribute('title')).toBe('Settings');
    expect(button.classList).toContain('btn-square');
    expect(button.classList).toContain('btn-sm');
    expect(button.querySelector('ui-icon svg')).not.toBeNull();
  });
});

describe('UiButtonGroup', () => {
  it('is a named group, joined unless gap is set', async () => {
    const { el } = await render();

    expect(el('joined').getAttribute('role')).toBe('group');
    expect(el('joined').getAttribute('aria-label')).toBe('View');
    expect(el('joined').dataset['layout']).toBe('joined');
    expect(el('spaced').dataset['layout']).toBe('gap');
    expect(el('spaced').hasAttribute('aria-label')).toBe(false);
  });
});
