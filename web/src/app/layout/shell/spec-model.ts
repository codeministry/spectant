import { computed, type Signal } from '@angular/core';
import type { SpecPageModel } from '../../../../../core/src/files';
import type { ShellData } from './shell-data.service';

/**
 * The spec payload once the spec route answered `ok`, else null (spec 061): what the spec page's parts read from the
 * payload the shell already loads (`ShellData.spec`) as it is. Layout's spec head parts and the spec feature's tabs and
 * rail call it in a field initialiser.
 */
export function specModel(data: Pick<ShellData, 'spec'>): Signal<SpecPageModel | null> {
  return computed(() => {
    const result = data.spec.value();
    return result?.kind === 'ok' ? result.body : null;
  });
}
