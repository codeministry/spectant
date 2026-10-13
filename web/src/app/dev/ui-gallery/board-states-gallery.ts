import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { BoardCard } from '../../features/spec/live/card/card';
import { AgentChip } from '../../features/spec/live/this-frame/agent-chip';
import { FrameBar } from '../../features/spec/live/this-frame/frame-bar';
import { UiIcon } from '../../shared/icons/icon';
import { UiButton } from '../../shared/ui/button/button';
import { UiCard, UiDisclosure, UiEmptyState, UiGlyph, UiSkeleton } from '../../shared/ui';
import { UiScrubber } from '../../shared/ui/scrubber/scrubber';
import {
  ACTIVE_SINCE,
  EVERY_CARD_STATE,
  IDLE_FRAMES,
  LANDED_CARDS,
  RECUT_FRAMES,
  RECUT_MARKERS,
  sampleCard,
  STALE_CARD,
  STALE_SINCE,
  WAITING_CARDS,
} from './gallery-samples';

/**
 * The board state gallery (T55; prototype `board-states.html`, `board.js` `statesPage`) as the section
 * `[data-gallery="board-states"]` of `/__ui`: no rounds yet, nothing in flight, a stale agent, the agent states, the
 * re-cut marker, filtered to nothing, every card state, the compact tier's frame bar and reduced motion, rendered with
 * the board's own components (card, scrubber, agent chip, frame bar) and static sample inputs. Dev-only strings.
 */
@Component({
  selector: 'app-board-states-gallery',
  imports: [AgentChip, BoardCard, FrameBar, UiButton, UiCard, UiDisclosure, UiEmptyState, UiGlyph, UiIcon, UiScrubber, UiSkeleton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './board-states-gallery.html',
  styleUrl: './state-galleries.css',
})
export class BoardStatesGallery {
  protected readonly idleFrames = IDLE_FRAMES;
  protected readonly idleValue = signal(0);
  protected readonly recutFrames = RECUT_FRAMES;
  protected readonly recutMarkers = RECUT_MARKERS;
  protected readonly recutValue = signal(RECUT_FRAMES.length - 1);
  protected readonly waiting = WAITING_CARDS;
  protected readonly landed = LANDED_CARDS;
  protected readonly staleCard = STALE_CARD;
  protected readonly activeSince = ACTIVE_SINCE;
  protected readonly staleSince = STALE_SINCE;
  protected readonly everyState = EVERY_CARD_STATE.map((state) =>
    sampleCard('T12', state, state === 'absent' ? { builder: 'Engineer', note: 'struck in the re-cut after R2' } : { builder: 'Engineer' }),
  );
}
