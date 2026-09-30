import { ChangeDetectionStrategy, Component, ElementRef, inject, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, vi } from 'vitest';
import type { SpecRowView } from '../../layout/shell/shell-data.service';
import { installArrival, isStage, planningPageState, stagesByRow, type PlanningPageData } from './planning-page';

// The pieces the Features and Milestones pages share (spec 003, ISC-103 / ISC-104): the stage map over the dashboard
// rows, the missing / unavailable pair over ShellData and the fragment arrival. The pages' own specs prove them in
// place; these pin each piece on its own.

const row = (id: string, stage: string): SpecRowView => ({ id, title: id, type: 'feature', stage });

describe('stagesByRow', () => {
  it('maps each active spec to its dashboard stage and drops a stage core does not know', () => {
    const map = stagesByRow([row('002', 'build'), row('003', 'nonsense'), row('004', 'code-review'), row('005', '')]);
    expect([...map]).toEqual([
      ['002', 'build'],
      ['004', 'code-review'],
    ]);
  });

  it("knows exactly core's stages (STAGE_RULES), none written here", () => {
    for (const stage of ['plan', 'tasks', 'review', 'build', 'blocked', 'code-review', 'close', 'done']) {
      expect(isStage(stage)).toBe(true);
    }
    expect(isStage('implement')).toBe(false);
  });
});

describe('planningPageState', () => {
  /** A stand-in for ShellData with only what the pair reads, every signal writable. */
  const data = () => ({
    workspaceMissing: signal(false),
    planningMissing: signal(false),
    workspaceUnavailable: signal(false),
    planningUnavailable: signal(false),
    planning: { value: signal<unknown>(undefined) },
    planningModel: signal<unknown>(null),
  }) satisfies PlanningPageData;

  it('is missing when the workspace or the tree answered 404', () => {
    const shell = data();
    const { missing } = planningPageState(shell);
    expect(missing()).toBe(false);
    shell.planningMissing.set(true);
    expect(missing()).toBe(true);
    shell.planningMissing.set(false);
    shell.workspaceMissing.set(true);
    expect(missing()).toBe(true);
  });

  it('is unavailable when either is unreadable, or the tree answered anything but the model', () => {
    const shell = data();
    const { unavailable } = planningPageState(shell);
    // Still loading: nothing answered, nothing unavailable.
    expect(unavailable()).toBe(false);
    shell.planning.value.set({ kind: 'error' });
    expect(unavailable()).toBe(true);
    shell.planningModel.set({ features: [] });
    expect(unavailable()).toBe(false);
    shell.workspaceUnavailable.set(true);
    expect(unavailable()).toBe(true);
  });
});

@Component({
  selector: 'app-arrival-host',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (id of ids(); track id) {
      <article [id]="id" tabindex="-1">{{ id }}</article>
    }
    <button type="button">elsewhere</button>
  `,
})
class ArrivalHost {
  readonly target = signal<string | null>(null);
  readonly ids = signal<readonly string[]>(['F1', 'F2']);

  constructor() {
    installArrival(inject<ElementRef<HTMLElement>>(ElementRef).nativeElement, this.target, () => this.ids());
  }
}

describe('installArrival', () => {
  const scroll = vi.fn();
  const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');

  beforeEach(() => {
    scroll.mockReset();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, writable: true, value: scroll });
  });

  afterEach(() => {
    if (original) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', original);
    else delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
  });

  async function host(): Promise<{ host: ArrivalHost; el: HTMLElement; render: () => Promise<void> }> {
    const fixture = TestBed.createComponent(ArrivalHost);
    const el = fixture.nativeElement as HTMLElement;
    document.body.appendChild(el);
    const render = async (): Promise<void> => {
      await fixture.whenStable();
      fixture.detectChanges();
    };
    await render();
    return { host: fixture.componentInstance, el, render };
  }

  const article = (el: HTMLElement, id: string): HTMLElement | null => el.querySelector<HTMLElement>(`article[id="${id}"]`);

  it('focuses and scrolls to the article the target names, once, and again on a new target', async () => {
    const { host: h, el, render } = await host();
    expect(scroll).not.toHaveBeenCalled();

    h.target.set('F2');
    await render();
    expect(document.activeElement).toBe(article(el, 'F2'));
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scroll).toHaveBeenCalledWith({ block: 'start', behavior: 'smooth' });

    // A later render with the same target does not pull focus back.
    el.querySelector<HTMLButtonElement>('button')?.focus();
    h.ids.set(['F1', 'F2', 'F3']);
    await render();
    expect(document.activeElement).toBe(el.querySelector('button'));
    expect(scroll).toHaveBeenCalledTimes(1);

    h.target.set('F1');
    await render();
    expect(document.activeElement).toBe(article(el, 'F1'));
    expect(scroll).toHaveBeenCalledTimes(2);
    el.remove();
  });

  it('waits for the article to render before it lands', async () => {
    const { host: h, el, render } = await host();
    h.target.set('m-harbor-1-0');
    await render();
    expect(scroll).not.toHaveBeenCalled();

    h.ids.set(['F1', 'm-harbor-1-0']);
    await render();
    expect(document.activeElement).toBe(article(el, 'm-harbor-1-0'));
    expect(scroll).toHaveBeenCalledTimes(1);
    el.remove();
  });
});
