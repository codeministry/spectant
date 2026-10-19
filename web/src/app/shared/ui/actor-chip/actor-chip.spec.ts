import { TestBed } from '@angular/core/testing';
import { TranslocoService, TranslocoTestingModule } from '@jsverse/transloco';
import { parseActor } from '../../../../../../core/src/actor';
import { CATALOGUES, LANGS } from '../../../../i18n/catalogues';
import { UiActorChip } from './actor-chip';

describe('UiActorChip', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [
        TranslocoTestingModule.forRoot({
          langs: CATALOGUES,
          translocoConfig: { availableLangs: [...LANGS], defaultLang: 'en', reRenderOnLangChange: true },
          preloadLangs: true,
        }),
      ],
    });
  });

  async function render(raw: string, inputs: Record<string, unknown> = {}) {
    const fixture = TestBed.createComponent(UiActorChip);
    fixture.componentRef.setInput('actor', parseActor(raw));
    for (const [key, value] of Object.entries(inputs)) fixture.componentRef.setInput(key, value);
    await fixture.whenStable();
    return { fixture, host: fixture.nativeElement as HTMLElement };
  }

  const label = (host: HTMLElement) => host.querySelector('.chip-label')?.textContent.trim();

  it('shows a person by the mapped name, with no avatar, initials or glyph', async () => {
    const { host } = await render('u:3fa2c91b', { name: 'Ada' });

    expect(host.getAttribute('data-kind')).toBe('person');
    expect(label(host)).toBe('Ada');
    expect(host.querySelector('.chip-label')?.classList.contains('mono')).toBe(false);
    expect(host.querySelector('ui-icon, img')).toBeNull();
    expect(host.getAttribute('title')).toBe('u:3fa2c91b');
  });

  it('falls back to the raw u: id in mono when the person is not mapped', async () => {
    const { host } = await render('u:3fa2c91b', { name: null });

    expect(label(host)).toBe('u:3fa2c91b');
    expect(host.querySelector('.chip-label')?.classList.contains('mono')).toBe(true);
    expect(host.getAttribute('data-tone')).toBe('neutral');
  });

  it('mutes a legacy value, keeps its raw string and names it legacy in words', async () => {
    const { fixture, host } = await render('Claude Opus');

    expect(host.getAttribute('data-kind')).toBe('legacy');
    expect(host.getAttribute('data-tone')).toBe('legacy');
    expect(host.style.getPropertyValue('--actor-ink')).toBe('var(--muted-ink)');
    expect(label(host)).toBe('Claude Opus');
    expect(host.querySelector('.suffix')?.textContent.trim()).toBe('legacy');

    TestBed.inject(TranslocoService).setActiveLang('de');
    await fixture.whenStable();
    expect(host.querySelector('.suffix')?.textContent.trim()).toBe('Altformat');
  });

  it('shows an agent with the bot glyph in the agent tone and its session id', async () => {
    const { host } = await render('a:claude:sess-7');

    expect(host.getAttribute('data-kind')).toBe('agent');
    expect(host.getAttribute('data-tone')).toBe('secondary');
    expect(host.style.getPropertyValue('--actor-ink')).toBe('var(--ques-ink)');
    expect(host.querySelector('ui-icon svg')).not.toBeNull();
    expect(label(host)).toBe('a:claude:sess-7');
    expect(host.querySelector('.task')).toBeNull();
    expect(host.querySelector('.vh')?.textContent.trim()).toBe('agent');
  });

  it('gives a sub-agent the bot glyph and its task suffix', async () => {
    const { host } = await render('a:claude:sess-7/T12');

    expect(host.getAttribute('data-kind')).toBe('subagent');
    expect(host.getAttribute('data-tone')).toBe('secondary');
    expect(host.querySelector('ui-icon svg')).not.toBeNull();
    expect(label(host)).toBe('a:claude:sess-7');
    expect(host.querySelector('.task')?.textContent.trim()).toBe('T12');
  });

  it('marks an active lock with a dot that is also said in words', async () => {
    const { host } = await render('a:claude:sess-7', { active: true });

    expect(host.hasAttribute('data-active')).toBe(true);
    expect(host.querySelector('.dot')?.getAttribute('aria-hidden')).toBe('true');
    expect(host.textContent).toContain('lock active');
    expect(host.querySelector('.stale')).toBeNull();
  });

  it('turns stale into the warning tone with a visible label, which wins over active', async () => {
    const { host } = await render('a:claude:sess-7', { active: true, stale: true, staleAge: '47 min' });

    expect(host.hasAttribute('data-stale')).toBe(true);
    expect(host.hasAttribute('data-active')).toBe(false);
    expect(host.getAttribute('data-tone')).toBe('warning');
    expect(host.style.getPropertyValue('--actor-ink')).toBe('var(--hover-ink)');
    expect(host.querySelector('.stale')?.textContent.trim()).toBe('no release · 47 min');
    expect(host.textContent).not.toContain('lock active');
  });

  it('labels stale without an age when none is given', async () => {
    const { host } = await render('a:claude:sess-7', { stale: true });

    expect(host.querySelector('.stale')?.textContent.trim()).toBe('no release');
  });
});
