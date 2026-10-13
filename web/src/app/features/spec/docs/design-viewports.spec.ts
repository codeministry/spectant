import { describe, expect, it } from 'vitest';
import { designViewports } from './design-viewports';

const HTML = `<h1 id="design-024">Design 024</h1>
<p>Intro.</p>
<h2 id="mobile-390">Mobile (390)</h2>
<h3 id="ist">Ist</h3>
<figure class="image-figure" data-figure="1"><img data-spec-asset=".design/mobile-ist.png" alt="Mobile now" loading="lazy"><figcaption>Mobile now</figcaption></figure>
<h3 id="soll">Soll</h3>
<p>The   pulse card
replaces the KPI band.</p>
<p>Second paragraph.</p>
<h2 id="phone">Phone</h2>
<h3 id="current">Current</h3>
<p>No screenshot.</p>
<h3 id="target">Target</h3>
<ul><li>Sheet over the list.</li></ul>
<h2 id="across">Viewport-übergreifend</h2>
<h3 id="decisions">Decisions</h3>
<p>Not a viewport.</p>`;

describe('designViewports (ISC-149)', () => {
  it('finds one card per h2 section that pairs an Ist with a Soll, in document order', () => {
    expect(designViewports(HTML)).toEqual([
      { id: 'mobile-390', name: 'Mobile', width: '390', ist: { path: '.design/mobile-ist.png', alt: 'Mobile now' }, soll: null, sollText: 'The pulse card replaces the KPI band.' },
      { id: 'phone', name: 'Phone', width: null, ist: null, soll: null, sollText: 'Sheet over the list.' },
    ]);
  });

  it('answers no card for a design.md without paired sections', () => {
    expect(designViewports('<h2 id="a">A</h2><h3 id="b">Ist</h3><p>x</p>')).toEqual([]);
    expect(designViewports('')).toEqual([]);
  });
});
