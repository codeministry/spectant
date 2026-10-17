// The shared display primitives (design.md § Components). Badge switcher and live indicator arrive with the header
// (spec 002's shell).
export { UiActorChip } from './actor-chip/actor-chip';
export { UiCard } from './card/card';
export { type ChipVariant, UiChip } from './chip/chip';
export { CHIP_ICON, chipIcon, RELATION_ICON } from './chip/chip-icons';
export { CLAMP_ELLIPSIS, type ClampPiece, fitWords, UiClamp } from './clamp/clamp';
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
  ITEM_ALIASES,
  ITEM_GLYPHS,
  ITEM_STATES,
  itemStateOf,
  stateKey,
} from './glyph/states';
export { type FilterOption, UiFilterChips } from './filter-chips/filter-chips';
export { UiIdChip } from './id-chip/id-chip';
export { UiIdeaChip } from './idea-chip/idea-chip';
export { UiKbd } from './kbd/kbd';
export { UiKpiTile } from './kpi-tile/kpi-tile';
export { UiLiveRegion } from './live-region/live-region';
export { type MeterSegment, UiMeter } from './meter/meter';
export { type NoticeTone, UiNotice } from './notice/notice';
export { UiDialog } from './overlay/dialog';
export { UiDocProse } from './doc-prose/doc-prose';
export { UiDisclosure } from './overlay/disclosure';
export { type PopoverPlacement, UiPopover, UiPopoverTrigger } from './overlay/popover';
export { type SheetTier, UiSheet } from './overlay/sheet';
export { DEFAULT_PRIORITY, PRIORITY_LOOK, type PriorityLook, UiPriority } from './priority/priority';
export { UiReason } from './reason/reason';
export { type RelativeFormat, type RelativeUnit, relativeParts, UiRelativeTime } from './relative-time/relative-time';
export { UiRing } from './ring/ring';
export { type RovingActive, UiRovingItem, UiRovingList } from './roving-list.directive';
export { type ScrubberFrame, type ScrubberMarker, UiScrubber } from './scrubber/scrubber';
export { UiSectionHeader } from './section-header/section-header';
export { type SegmentedOption, UiSegmented } from './segmented/segmented';
export { UiSkeleton } from './skeleton/skeleton';
export { UiSourceChip } from './source-chip/source-chip';
export { type StageState, UiStageTrack } from './stage-track/stage-track';
export { UiStateChip } from './state-chip/state-chip';
export { UiTerm } from './term/term';
export { TYPE_GLYPHS, type TypeGlyphKind, UiTypeGlyph } from './type-glyph/type-glyph';
export { TOAST_MS, ToastService, UiToast } from './toast/toast';
export { UiWaitsChip, WAITS_VISIBLE } from './waits-chip/waits-chip';
export { type Tone, toneColor, toneInk, toneMark, toneTint } from './tone';
export { UiWorktreeChip } from './worktree-chip/worktree-chip';
export { UiWsBadge, type WsBadgeSize } from './ws-badge/ws-badge';
export { UiWsCover } from './ws-badge/ws-cover';
export { WS_ACCENT_TOKENS, type WsAccent, wsAccent, wsHash, wsMonogram, type WsPattern, wsPattern } from './ws-badge/ws-identity';
