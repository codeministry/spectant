import type { Router } from '@angular/router';
import type { PaletteEntry } from '../../core/palette-sources';

/** The keyCode an input method reports while it owns the key. */
const IME_KEY_CODE = 229;

/**
 * Whether a keydown is the Enter that follows the highlighted palette entry (ISC-60.2). An Enter that commits an input
 * method's composition belongs to the input method: Chromium and Firefox flag it with `isComposing`, WebKit (the cmux
 * web view) sends it with `isComposing` already false but keyCode 229, so both are checked.
 */
export function isCommitEnter(event: KeyboardEvent): boolean {
  // keyCode is deprecated, but it is WebKit's only signal for the committing Enter.
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  return event.key === 'Enter' && !event.isComposing && event.keyCode !== IME_KEY_CODE;
}

/**
 * Follows a navigating entry through the Angular router, so the page is never reloaded: a URL string (a target with a
 * fragment, `/w/harbor/features#F2`) by `navigateByUrl`, a router link (`['/w', ws, 's', id]`) by `navigate`.
 */
export function follow(router: Router, entry: PaletteEntry): Promise<boolean> {
  const link = entry.link;
  return typeof link === 'string' ? router.navigateByUrl(link) : router.navigate([...link]);
}
