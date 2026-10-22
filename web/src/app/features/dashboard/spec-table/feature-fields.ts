import { type Loose, text } from '../../../layout/shell/loose';

/** The feature column of a spec or idea row: the main feature (`F<n>`), its name in the master and the milestone. */
export interface FeatureFields {
  readonly feature: string | null;
  /** The master block's heading after `F<n> ·`: the feature id's tooltip and accessible name, never shown. */
  readonly featureName: string | null;
  readonly milestone: string | null;
}

/** The three fields as core sends them on a dashboard spec row and a story, each null when absent or not a string. */
export const featureOf = (row: Loose): FeatureFields => ({ feature: text(row['feature']), featureName: text(row['featureName']), milestone: text(row['milestone']) });
