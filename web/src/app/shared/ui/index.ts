// The shared display primitives (design.md § Components). Badge switcher and live indicator arrive with the header
// (spec 002's shell).
export { UiCard } from './card/card';
export { UiChip } from './chip/chip';
export { UiCommandChip, writeClipboard } from './command-chip/command-chip';
export { UiEmptyState } from './empty-state/empty-state';
export { UiGlyph } from './glyph/glyph';
export {
  CARD_GLYPHS,
  CARD_STATES,
  CLAIM_GLYPHS,
  CLAIM_STATES,
  type GlyphFamily,
  type GlyphShape,
  type GlyphSpec,
  type GlyphState,
  glyphFamily,
  glyphSpec,
  stateKey,
} from './glyph/states';
export { type FilterOption, UiFilterChips } from './filter-chips/filter-chips';
export { UiIdChip } from './id-chip/id-chip';
export { UiKbd } from './kbd/kbd';
export { UiKpiTile } from './kpi-tile/kpi-tile';
export { UiLiveRegion } from './live-region/live-region';
export { type MeterSegment, UiMeter } from './meter/meter';
export { type NoticeTone, UiNotice } from './notice/notice';
export { UiDialog } from './overlay/dialog';
export { UiDisclosure } from './overlay/disclosure';
export { type PopoverPlacement, UiPopover, UiPopoverTrigger } from './overlay/popover';
export { type SheetTier, UiSheet } from './overlay/sheet';
export { type RelativeFormat, type RelativeUnit, relativeParts, UiRelativeTime } from './relative-time/relative-time';
export { UiRing } from './ring/ring';
export { type RovingActive, UiRovingItem, UiRovingList } from './roving-list.directive';
export { type ScrubberFrame, type ScrubberMarker, UiScrubber } from './scrubber/scrubber';
export { UiSectionHeader } from './section-header/section-header';
export { type SegmentedOption, UiSegmented } from './segmented/segmented';
export { UiSkeleton } from './skeleton/skeleton';
export { type StageState, UiStageTrack } from './stage-track/stage-track';
export { UiStateChip } from './state-chip/state-chip';
export { UiTerm } from './term/term';
export { TOAST_MS, ToastService, UiToast } from './toast/toast';
export { type Tone, toneColor, toneInk, toneMark, toneTint } from './tone';
