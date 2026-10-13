import { pathOf } from './scroll-top';

describe('pathOf', () => {
  it('drops the query and the fragment, so a preview or an anchor is not a new page', () => {
    expect(pathOf('/w/harbor?spec=007')).toBe('/w/harbor');
    expect(pathOf('/w/harbor#specs')).toBe('/w/harbor');
    expect(pathOf('/w/harbor/s/007/claims?x=1#claim-ISC-5')).toBe('/w/harbor/s/007/claims');
    expect(pathOf('/')).toBe('/');
  });
});
