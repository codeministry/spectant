import { computed, inject, Injectable, resource } from '@angular/core';
import { ApiClient } from '../../core/api.service';
import type { AreaId } from '../../layout/shell/areas';
import { ShellData } from '../../layout/shell/shell-data.service';
import { ShellState } from '../../layout/shell/shell-state.service';
import { specParams } from './spec-view';
import { openClaims } from './status/status-model';

/**
 * The areas whose tabs share the spec rail; the dashboard registers its own rail, and the Library and the live area
 * (spec 075) have none (`no-rail`, spec 017: the shell draws no rail column there, `SpecArea.noRail`).
 */
const RAIL_AREAS: ReadonlySet<AreaId> = new Set(['status', 'data', 'notes']);

/**
 * The state of the spec page (`SpecPage`, spec 061): whether the spec rail shows, and the open claims the rail's
 * `take` chip reads from the Claims route. The claims load only while the rail shows, as they did when the rail loaded
 * them itself; the page hands the first takeable claim and the busy flag to `app-spec-rail` as inputs.
 */
@Injectable()
export class SpecStore {
  private readonly api = inject(ApiClient);
  private readonly data = inject(ShellData);
  private readonly state = inject(ShellState);

  /** The rail only once the spec answered, at wide, on a tab of the rail areas. */
  readonly railShown = computed(() => {
    const area = this.state.area();
    return this.state.tier() === 'wide' && area !== null && RAIL_AREAS.has(area) && this.data.spec.value()?.kind === 'ok';
  });

  private readonly route = specParams(this.state);

  /** The open claims, for the rail's `take` chip (core's `ClaimViewModel`); idle while the rail is hidden. */
  private readonly claims = resource({
    params: () => (this.railShown() ? this.route() : undefined),
    loader: ({ params }) => this.api.claims(params.ws, params.id),
  });

  /** While the take chip's claims load, the rail says it is busy. */
  readonly claimsLoading = computed(() => this.claims.isLoading());

  /** The first takeable claim, the rail's `take` chip (e.g. "takeable ISC-334"). */
  readonly firstTakeable = computed(() => {
    const result = this.claims.value();
    return result?.kind === 'ok' ? (openClaims(result.body.claims).find((claim) => claim.state === 'takeable')?.id ?? null) : null;
  });
}
