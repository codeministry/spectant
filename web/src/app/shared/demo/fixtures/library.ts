/** A curated document of the Library mock (prototype `library.js`, design.md § Library), until spec 017 delivers it. */
export type DemoLibraryType = 'plan' | 'design' | 'decisions' | 'constitution' | 'evidence' | 'notes';

export interface DemoLibraryEntry {
  readonly id: string;
  /** The spec ID the document belongs to, `ws` for a workspace-wide one (the constitution). */
  readonly spec: string;
  readonly type: DemoLibraryType;
  readonly title: string;
  /** The file inside the workspace, relative to its root. */
  readonly file: string;
  /** ISO 8601 timestamp of the last change. */
  readonly updated: string;
  /** Why the document may be out of date, absent when it is current. */
  readonly stale?: string;
  /** Terms and claim IDs the cross-reference panel links. */
  readonly refs: readonly string[];
  /** Markdown body. */
  readonly body: string;
}

export const DEMO_LIBRARY: readonly DemoLibraryEntry[] = Object.freeze([
  {
    id: '002-plan',
    spec: '002',
    type: 'plan',
    title: 'Approach & architecture',
    file: 'specs/002-web-console/plan.md',
    updated: '2026-03-06T11:10:00Z',
    stale: 'spec.md changed in round 3 — plan not re-read since',
    refs: ['ETag', 'ISC-337', 'lanes'],
    body: '## Approach\nThe dashboard is a pure function of the files. The server parses spec folders into one model; the web client renders it and polls with an ETag.',
  },
  {
    id: '002-design',
    spec: '002',
    type: 'design',
    title: 'Viewports 390 · 820 · 1440',
    file: 'specs/002-web-console/design.md',
    updated: '2026-03-07T09:48:00Z',
    refs: ['ISC-331', 'Next up'],
    body: '## Mobile · 390\nPulse card replaces the KPI band; Next up and Warnings move into the main column.',
  },
  {
    id: 'ws-constitution',
    spec: 'ws',
    type: 'constitution',
    title: 'Constitution',
    file: 'specs/constitution.md',
    updated: '2026-03-04T10:00:00Z',
    refs: ['lanes'],
    body: '## Lanes\n- web — `web/src/**`\n- server — `server/src/**`\n- core — `core/**`',
  },
  {
    id: '002-ev-t13',
    spec: '002',
    type: 'evidence',
    title: 'T13-routes.md',
    file: 'specs/002-web-console/artifacts/T13-routes.md',
    updated: '2026-03-07T12:38:00Z',
    refs: ['ISC-337', 'ETag'],
    body: '## Result\n`GET /api/specs` answers **304** when the ETag matches; 9 routes covered.',
  },
] satisfies DemoLibraryEntry[]);
