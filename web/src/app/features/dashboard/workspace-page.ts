import { computed } from '@angular/core';
import type { ShellData } from '../../layout/shell/shell-data.service';
import type { ShellState } from '../../layout/shell/shell-state.service';

/**
 * What the dashboard and the Specs page both read of the open workspace: its slug (`ws`), the registry's path tail
 * for the footnote ('' while unknown), the dashboard body (null until it answers ok) and that body through the page's
 * own narrow view (`read`, null while the body lacks what the page reads). Called in a field initializer.
 */
export function workspacePage<V>(state: ShellState, data: ShellData, read: (body: unknown) => V | null) {
  const ws = computed(() => state.ws() ?? '');
  const pathTail = computed(() => data.workspaceList().find((entry) => entry.slug === ws())?.pathTail ?? '');
  const body = computed(() => {
    const result = data.dashboard.value();
    return result?.kind === 'ok' ? result.body : null;
  });
  const view = computed(() => read(body()));
  return { ws, pathTail, body, view };
}
