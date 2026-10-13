/** A row of the workspace management mock (prototype `workspaces.html` `ws-row`, design.md § Workspace-Verwaltung), until spec 016. */
export interface DemoWorkspaceRow {
  readonly name: string;
  /** The repository path as the registry shows it, relative to the developer's code folder. */
  readonly path: string;
  readonly specs: number;
  /** Specs in an active stage. */
  readonly active: number;
  /** ISO 8601 timestamp of the last scan. */
  readonly scanned: string;
  readonly state: 'ok' | 'missing';
}

/** The folders the add row's path completion offers (prototype `FOLDERS`, `.path-pop`), a trailing `/` for a parent. */
export const DEMO_FOLDERS: readonly string[] = Object.freeze([
  '~/Development/',
  '~/Development/oss/',
  '~/Development/oss/spectant',
  '~/Development/oss/sample-lib',
  '~/Development/work/',
  '~/Development/work/example-app',
  '~/Development/archive/',
  '~/Downloads/',
  '~/Documents/',
]);

export const DEMO_WORKSPACES: readonly DemoWorkspaceRow[] = Object.freeze([
  { name: 'spectant', path: 'oss/spectant', specs: 24, active: 3, scanned: '2026-03-07T14:02:00Z', state: 'ok' },
  { name: 'example-app', path: 'work/example-app', specs: 6, active: 2, scanned: '2026-03-07T13:40:00Z', state: 'ok' },
  { name: 'sample-lib', path: 'oss/sample-lib', specs: 3, active: 0, scanned: '2026-03-05T09:12:00Z', state: 'ok' },
  { name: 'old-prototype', path: 'archive/old-prototype', specs: 1, active: 0, scanned: '2026-02-20T17:30:00Z', state: 'missing' },
] satisfies DemoWorkspaceRow[]);
