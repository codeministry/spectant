// The shared display primitives (design.md § Components). Buttons, popover, sheet, dialog, disclosure, badge
// switcher and live indicator arrive with their own tasks (T24, T26, T27).
export { UiCard } from './card/card';
export { UiChip } from './chip/chip';
export { UiCommandChip, writeClipboard } from './command-chip/command-chip';
export { UiEmptyState } from './empty-state/empty-state';
export { type FilterOption, UiFilterChips } from './filter-chips/filter-chips';
export { UiIdChip } from './id-chip/id-chip';
export { UiKbd } from './kbd/kbd';
export { UiKpiTile } from './kpi-tile/kpi-tile';
export { UiLiveRegion } from './live-region/live-region';
export { type MeterSegment, UiMeter } from './meter/meter';
export { type NoticeTone, UiNotice } from './notice/notice';
export { type RelativeFormat, type RelativeUnit, relativeParts, UiRelativeTime } from './relative-time/relative-time';
export { UiRing } from './ring/ring';
export { UiSectionHeader } from './section-header/section-header';
export { type SegmentedOption, UiSegmented } from './segmented/segmented';
export { UiSkeleton } from './skeleton/skeleton';
export { type StageState, UiStageTrack } from './stage-track/stage-track';
export { type Tone, toneColor, toneInk, toneTint } from './tone';
