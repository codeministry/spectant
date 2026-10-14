import { Injectable, type Signal, signal } from '@angular/core';
import { DEMO_ASSISTANT_FALLBACK, DEMO_ASSISTANT_REPLIES, type DemoAssistantReply } from './fixtures/assistant';
import { DEMO_IDENTITIES, type DemoIdentity } from './fixtures/identity';
import { DEMO_FOLDERS, DEMO_WORKSPACES, type DemoWorkspaceRow } from './fixtures/workspaces';

/**
 * The one door to demo data (spec 024, ISC-149.1): every element the app shows before its spec delivers the real thing
 * (workspace management until 016, the assistant until 012/015, workspace identity images; the Library left with
 * spec 017) reads its fixture here and nowhere else.
 *
 * Rules, held by `web/tests/demo-readonly.test.ts` (the static half; `parity.spec.ts` group `demo` is the e2e half):
 *
 * - **Read only.** Fixtures are frozen, the service hands out read-only signals and lookups; it has no write, save,
 *   put, post, delete, update or upload method.
 * - **No host.** Nothing under `shared/demo/` imports `ApiClient`, `HttpClient` or calls `fetch`; no request leaves
 *   the page, loopback included.
 * - **Self-contained.** Files here import `@angular/core` and each other only; features import `DemoData` and the
 *   fixture types from `shared/demo/demo-data`, never a fixture module.
 *
 * **The mock convention.** Every mocked block marks its root with `data-demo` (`DEMO_BLOCK_ATTR`) and puts
 * `<ui-chip variant="demo" />` at the end of its own head row: the section head or eyebrow of a block, behind the h1 of
 * a whole mocked page, in the `as-head` of the assistant (design.md § Across viewports). The chip is never only a
 * tooltip; `[data-demo]` without a `[data-demo-chip]` inside is a defect.
 */
export const DEMO_BLOCK_ATTR = 'data-demo';

export type { DemoAccent, DemoIdentity } from './fixtures/identity';
export type { DemoAssistantReply } from './fixtures/assistant';
export type { DemoWorkspaceRow } from './fixtures/workspaces';

@Injectable({ providedIn: 'root' })
export class DemoData {
  readonly workspaces: Signal<readonly DemoWorkspaceRow[]> = signal(DEMO_WORKSPACES).asReadonly();
  /** The folders the add row's path completion offers (prototype `.path-pop`). */
  readonly folders: Signal<readonly string[]> = signal(DEMO_FOLDERS).asReadonly();
  readonly assistantSuggestions: Signal<readonly DemoAssistantReply[]> = signal(DEMO_ASSISTANT_REPLIES).asReadonly();
  readonly identities: Signal<readonly DemoIdentity[]> = signal(DEMO_IDENTITIES).asReadonly();

  /** The canned answer to a prompt: the matching suggestion's reply, else the fixture's fallback. */
  assistantReply(prompt: string): string {
    const asked = prompt.trim().toLowerCase();
    return DEMO_ASSISTANT_REPLIES.find((entry) => entry.prompt.toLowerCase() === asked)?.reply ?? DEMO_ASSISTANT_FALLBACK;
  }

  /** A workspace's demo identity, `undefined` where the fixture has none (the name pattern stands in). */
  identity(workspace: string): DemoIdentity | undefined {
    return DEMO_IDENTITIES.find((entry) => entry.workspace === workspace);
  }
}
