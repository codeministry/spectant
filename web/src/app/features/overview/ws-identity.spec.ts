import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { CATALOGUES, LANGS } from '../../../i18n/catalogues';
import { WsIdentity } from './ws-identity';

/** Spec 066 T10 (ISC-516): the tile head, two lines in 48 px, with the parent's "Updated" time projected into line 2. */
@Component({
  selector: 'app-ws-identity-host',
  imports: [WsIdentity],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<app-ws-identity name="harbor" slug="harbor" pathTail="code/harbor" [link]="link()"><span data-updated>Updated 3 min ago</span></app-ws-identity>`,
})
class Host {
  readonly link = signal(true);
}

async function render(link = true): Promise<HTMLElement> {
  TestBed.configureTestingModule({
    imports: [
      TranslocoTestingModule.forRoot({
        langs: CATALOGUES,
        translocoConfig: { availableLangs: [...LANGS], defaultLang: 'en' },
        preloadLangs: true,
      }),
    ],
    providers: [provideRouter([])],
  });
  const fixture = TestBed.createComponent(Host);
  fixture.componentInstance.link.set(link);
  await fixture.whenStable();
  return (fixture.nativeElement as HTMLElement).querySelector('app-ws-identity') as HTMLElement;
}

const text = (el: Element | null | undefined): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('WsIdentity, the tile head (spec 066 T10, ISC-516)', () => {
  it('is the head block of the tile and holds no cover: the preview moved out into its own track', async () => {
    const head = await render();
    expect(head.getAttribute('data-tile-block')).toBe('head');
    expect(head.querySelector('ui-ws-cover, [data-ws-cover]')).toBeNull();
    // The identity is core's data, no mock (ISC-149.1): no `[data-demo]` mark and no demo chip in the head.
    expect(head.matches('[data-demo], [data-demo-head]') || head.querySelector('[data-demo], [data-demo-head], [data-demo-chip]') !== null).toBe(false);
  });

  it('stacks two lines beside the lg badge: the name alone, then path tail, separator and the updated time', async () => {
    const head = await render();
    const badge = head.querySelector('.ws-head [data-ws-badge]');
    expect(badge?.getAttribute('data-size')).toBe('lg');
    expect(text(badge)).toBe('HA');
    const line1 = head.querySelector('[data-head-line="1"]');
    const line2 = head.querySelector('[data-head-line="2"]');
    expect(text(line1?.querySelector('h2'))).toBe('harbor');
    expect(line1?.querySelector('[data-ws-badge], .path, [data-updated], ui-chip')).toBeNull();
    const parts = [...(line2?.children ?? [])].map((el) => (el.classList.contains('path') ? 'path' : el.classList.contains('sep') ? 'sep' : el.querySelector('[data-updated]') ? 'updated' : el.tagName));
    expect(parts).toEqual(['path', 'sep', 'updated']);
    expect(text(line2?.querySelector('.path'))).toBe('code/harbor');
    expect(text(line2?.querySelector('[data-updated]'))).toBe('Updated 3 min ago');
    expect(line2?.querySelector('.sep')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('links badge and name to the workspace, with one tab stop; a loading or unreadable head links nothing', async () => {
    const head = await render();
    const links = [...head.querySelectorAll('a')];
    expect(new Set(links.map((a) => a.getAttribute('href')))).toEqual(new Set(['/w/harbor']));
    expect(links.filter((a) => a.getAttribute('tabindex') !== '-1').length).toBe(1);
    expect(head.querySelector('.ws-head a h2')).not.toBeNull();
    TestBed.resetTestingModule();
    const plain = await render(false);
    expect(plain.querySelector('a')).toBeNull();
    expect(text(plain.querySelector('h2'))).toBe('harbor');
  });
});
