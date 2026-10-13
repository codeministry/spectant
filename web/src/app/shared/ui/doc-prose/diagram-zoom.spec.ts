import { DiagramZoom, ZOOM_STEPS } from './diagram-zoom';

describe('DiagramZoom (ISC-154.1)', () => {
  it('steps from 100 % through every level and stops at both bounds', () => {
    const applied: number[] = [];
    const zoom = new DiagramZoom((factor) => applied.push(factor));
    expect(zoom.percent()).toBe(100);
    for (let i = 0; i < 6; i += 1) zoom.zoomIn();
    expect(zoom.percent()).toBe(300);
    expect(zoom.atMax()).toBe(true);
    zoom.reset();
    for (let i = 0; i < 4; i += 1) zoom.zoomOut();
    expect(zoom.percent()).toBe(50);
    expect(zoom.atMin()).toBe(true);
    expect(applied).toEqual([1.25, 1.5, 2, 3, 1, 0.75, 0.5]);
    expect([...ZOOM_STEPS]).toEqual([50, 75, 100, 125, 150, 200, 300]);
  });
});
