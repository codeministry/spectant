import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { UiFlatTile } from './flat-tile';
import { TILE_DENSITY_MIN, TILE_HEIGHT_LINE, TILE_HEIGHT_STACKED, TILE_LIMIT } from './tiles';

@Component({
  imports: [UiFlatTile],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ui-flat-tile
      [link]="['/w', 'harbor', 's', '064']"
      fragment="claims"
      name="064 Flat tiles · T2 · waiting 2 d"
      description="Take care of T2 yourself"
      hint="Take care of T2 yourself"
    >
      <span tileMark class="t-mark">*</span>
      <span tileId class="t-id">064</span>
      <span tileMain class="t-main">Flat tiles</span>
      <button tileAside type="button" class="t-copy">copy</button>
      <span tileMeta class="t-meta">2 d</span>
    </ui-flat-tile>
  `,
})
class TileHost {}

const render = async (): Promise<HTMLElement> => {
  TestBed.configureTestingModule({ providers: [provideRouter([])] });
  const fixture = TestBed.createComponent(TileHost);
  await fixture.whenStable();
  return fixture.nativeElement as HTMLElement;
};

describe('UiFlatTile', () => {
  it('shares one limit, two heights and the density threshold for both tile lists (T9)', () => {
    expect(TILE_LIMIT).toBe(3);
    expect(TILE_HEIGHT_LINE).toBe(48);
    expect(TILE_HEIGHT_STACKED).toBe(72);
    expect(TILE_DENSITY_MIN).toBe(560);
  });

  it('renders one link over the whole tile with the given name, target and hint', async () => {
    const host = await render();
    const links = host.querySelectorAll('ui-flat-tile a');

    expect(links).toHaveLength(1);
    const link = links[0];
    expect(link.getAttribute('href')).toBe('/w/harbor/s/064#claims');
    expect(link.getAttribute('aria-label')).toBe('064 Flat tiles · T2 · waiting 2 d');
    expect(link.getAttribute('title')).toBe('Take care of T2 yourself');
    expect(link.classList.contains('cover')).toBe(true);
  });

  // The link is the tile's cover and carries the global focus ring itself (ISC-64), so it holds no visible content:
  // the id stands in its own cell, hidden from assistive tech because the link's name already starts with it.
  it('draws the id in its own cell beside the link, hidden from assistive tech', async () => {
    const host = await render();
    const id = host.querySelector('.t-id');

    expect(id?.textContent).toBe('064');
    expect(id?.closest('a')).toBeNull();
    expect(id?.closest('.id')?.getAttribute('aria-hidden')).toBe('true');
    expect(host.querySelector('ui-flat-tile a')?.textContent.trim()).toBe('');
  });

  it('wires the description to the link through aria-describedby', async () => {
    const host = await render();
    const link = host.querySelector('ui-flat-tile a');
    const id = link?.getAttribute('aria-describedby') ?? '';

    expect(id).not.toBe('');
    const description = host.querySelector(`#${id}`);
    expect(description?.textContent.trim()).toBe('Take care of T2 yourself');
    expect(description?.closest('a')).toBeNull();
  });

  it('keeps the aside button outside the link and renders every slot in its own cell', async () => {
    const host = await render();
    const button = host.querySelector('.t-copy');

    expect(button).not.toBeNull();
    expect(button?.closest('a')).toBeNull();
    expect(button?.closest('.aside')).not.toBeNull();
    expect(host.querySelector('.mark .t-mark')).not.toBeNull();
    expect(host.querySelector('.main .t-main')?.textContent).toBe('Flat tiles');
    expect(host.querySelector('.meta .t-meta')?.textContent).toBe('2 d');
  });

  it('leaves out description and hint when none is given', async () => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(UiFlatTile);
    fixture.componentRef.setInput('link', '/w/harbor/s/064');
    fixture.componentRef.setInput('name', '064 Flat tiles');
    await fixture.whenStable();
    const link = (fixture.nativeElement as HTMLElement).querySelector('a');

    expect(link?.getAttribute('href')).toBe('/w/harbor/s/064');
    expect(link?.hasAttribute('aria-describedby')).toBe(false);
    expect(link?.hasAttribute('title')).toBe(false);
  });
});
