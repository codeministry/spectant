/** The prototype's accent token names (`identity.js` `TOKENS`); a mock maps them onto the app's tones. */
export type DemoAccent = 'teal' | 'cyan' | 'lime' | 'violet' | 'orange' | 'yellow' | 'green' | 'red';

/** A workspace identity of the identity mock (prototype `identity.js`, design.md § Workspace-Identitätsbilder). */
export interface DemoIdentity {
  readonly workspace: string;
  /** Initials for the `ws-badge`. */
  readonly monogram: string;
  readonly accent: DemoAccent;
  /** A bundled image path, `null` where the name pattern stands in; never a remote URL. */
  readonly image: string | null;
}

export const DEMO_IDENTITIES: readonly DemoIdentity[] = Object.freeze([
  { workspace: 'spectant', monogram: 'SP', accent: 'cyan', image: null },
  { workspace: 'example-app', monogram: 'EA', accent: 'violet', image: null },
  { workspace: 'sample-lib', monogram: 'SL', accent: 'lime', image: null },
] satisfies DemoIdentity[]);
