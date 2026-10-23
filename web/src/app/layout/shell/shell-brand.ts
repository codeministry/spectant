import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { UiBrandMark } from '../../shared/ui/brand-mark/brand-mark';

/**
 * The header's brand (design.md § Wordmark, ISC-73; spec 024 T34): the living ring, lime into cyan, and the Sora wordmark "spect" + "ant", one link to
 * all workspaces. The ring is a track, an almost closed arc and the violet dot in its gap, `ui-brand-mark` at 27 px
 * (spec 072); the hover and focus spin here rotates its host. The wordmark text is the first thing the header drops
 * below 640 px, where the ring stands alone in its 40 px rail. The host sits in the header grid's `brand` area.
 */
@Component({
  selector: 'app-shell-brand',
  imports: [RouterLink, TranslocoPipe, UiBrandMark],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './shell-brand.html',
  styleUrl: './shell-brand.css',
})
export class ShellBrand {}
