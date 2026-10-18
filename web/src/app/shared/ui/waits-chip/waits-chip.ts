import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';
import type { SpecWait } from '../../../../../../core/src/files';
import { UiIcon } from '../../icons/icon';

/** How many blocker chips stand visibly before the rest folds into `+n` (spec 025 design.md, Mehrere Blocker). */
export const WAITS_VISIBLE = 2;

interface BlockerView {
  readonly id: string;
  /** The blocker spec's page, `/w/:ws/s/NNN`; null for a number no spec carries (`unknownBlockers`), drawn unlinked. */
  readonly link: readonly string[] | null;
  /** The accessible name and tooltip: "Waits on spec 002, Web console" (the partial scope appended when off-screen). */
  readonly name: string;
}

/**
 * Spec 025 (T21, ISC-163): `dependency-chip.waits`, the "waits on NNN" a spec carries while an open spec edge holds its
 * open work. The same primitive sits in the spec head, on the board card and in the spec table.
 *
 * - One chip per blocker, at most `WAITS_VISIBLE`; from three on a neutral dashed `+n` whose tooltip and hidden text
 *   name the rest. A chip is exactly "waits on NNN" / "wartet auf NNN", never more words.
 * - Violet (scoping), not filled: 1 px dashed `--color-secondary` (the prototype's `--violet`), ink `--ques-ink`, `clock`
 *   12 px, mono 500 11, 22 px high; hover `--ques-t`, the number dotted-underlined, focus the app's ring.
 * - A known blocker links to its spec page; an unknown one (`042`) is a plain span with the same look and no link.
 * - `meta`: the partial scope ("4 waiting · 1 open", spec 021 ISC-252.1: `heldTasks` and `readyTasks`, the Tasks tab's
 *   `held` and `open` chip counts) as a separate muted `.meta` behind the chips, never inside the chip text; without it (narrow surfaces) the scope lives in the first chip's accessible name and tooltip. A full hold
 *   carries no scope: the stage chip already reads `blocked`.
 * - Under `pointer: coarse` each chip gets a 44 × 44 hit area through `::before`, as `ui-button` does.
 */
@Component({
  selector: 'ui-waits-chip',
  imports: [RouterLink, UiIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-full]': 'wait().full ? "" : null' },
  styles: `
    :host { display: inline-flex; flex-wrap: wrap; gap: 4px 6px; align-items: center; min-inline-size: 0; }
    .waits {
      position: relative; display: inline-flex; flex: none; gap: 4px; align-items: center; box-sizing: border-box; block-size: 22px;
      padding-inline: 7px; border: 1px dashed var(--color-secondary); border-radius: 4px; background: none; color: var(--ques-ink);
      font-family: var(--font-mono); font-size: 11px; font-weight: 500; line-height: 1; text-decoration: none; white-space: nowrap;
    }
    .num { text-decoration: underline dotted; text-underline-offset: 2px; }
    a.waits:hover { background: var(--ques-t); }
    a.waits:hover .num, a.waits:focus-visible .num { text-decoration-style: solid; }
    span.waits .num { text-decoration: none; }
    .more { border-color: var(--line); color: var(--muted-ink); }
    .meta { color: var(--muted-ink); font-size: 12px; line-height: 16px; }
    .visually-hidden { position: absolute; inline-size: 1px; block-size: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
    @media (pointer: coarse) {
      .waits::before { content: ""; position: absolute; inset: 50% auto auto 50%; translate: -50% -50%; inline-size: max(100%, 44px); block-size: max(100%, 44px); }
    }
    @media (forced-colors: active) {
      .waits { border-color: CanvasText; color: CanvasText; }
      a.waits { color: LinkText; }
    }
  `,
  template: `
    @for (blocker of visible(); track blocker.id) {
      @if (blocker.link; as link) {
        <a class="waits" data-waits [attr.data-blocker]="blocker.id" [routerLink]="link" [attr.aria-label]="blocker.name" [attr.title]="blocker.name">
          <ui-icon name="clock" [size]="12" />{{ prefix() }} <span class="num">{{ blocker.id }}</span>
        </a>
      } @else {
        <span class="waits" data-waits data-unknown [attr.data-blocker]="blocker.id" [attr.title]="blocker.name">
          <ui-icon name="clock" [size]="12" /><span class="label" aria-hidden="true">{{ prefix() }} <span class="num">{{ blocker.id }}</span></span>
          <span class="visually-hidden">{{ blocker.name }}</span>
        </span>
      }
    }
    @if (rest(); as rest) {
      <span class="waits more" data-waits-more [attr.title]="rest.name">
        <span aria-hidden="true">+{{ rest.count }}</span>
        <span class="visually-hidden">{{ rest.name }}</span>
      </span>
    }
    @if (metaText(); as text) {
      <span class="meta" data-waits-meta>· {{ text }}</span>
    }
  `,
})
export class UiWaitsChip {
  private readonly transloco = inject(TranslocoService);
  private readonly lang = toSignal(this.transloco.langChanges$, { initialValue: this.transloco.getActiveLang() });

  /** The row's or head's `waits` as core delivers it; the host renders only when it is non-null. */
  readonly wait = input.required<SpecWait>();
  /** The workspace slug, for the blocker links. */
  readonly ws = input.required<string>();
  /** Blocker titles by number, for the accessible name; a missing one leaves the name at "Waits on spec NNN". */
  readonly titles = input<Readonly<Record<string, string>>>({});
  /** The partial scope as visible `.meta` behind the chips (spec head); off on narrow surfaces (board card, table). */
  readonly meta = input(false);

  private t(key: string, params: Record<string, unknown> = {}): string {
    // `translate` reads no signal: the language is read so the texts follow a language switch.
    return this.transloco.translate(`waits.${key}`, params, this.lang());
  }

  protected readonly prefix = computed(() => this.t('on'));

  /** "4 waiting · 1 open" for a partial hold, in the Tasks tab's chip units; null for a full one. */
  private readonly scope = computed(() => {
    const { full, heldTasks, readyTasks } = this.wait();
    return full ? null : this.t(heldTasks === 1 ? 'partial.one' : 'partial.other', { held: heldTasks, ready: readyTasks });
  });

  private readonly blockers = computed<readonly BlockerView[]>(() => {
    const { blockers, unknownBlockers = [] } = this.wait();
    const titles = this.titles();
    const scope = this.meta() ? null : this.scope();
    return blockers.map((id, index) => {
      const unknown = unknownBlockers.includes(id);
      const title = Object.hasOwn(titles, id) ? titles[id] : undefined;
      const base = unknown ? this.t('unknown', { id }) : title ? this.t('name', { id, title }) : this.t('nameBare', { id });
      return {
        id,
        link: unknown ? null : ['/w', this.ws(), 's', id],
        name: index === 0 && scope !== null ? `${base}, ${scope}` : base,
      };
    });
  });

  protected readonly visible = computed(() => this.blockers().slice(0, WAITS_VISIBLE));
  protected readonly rest = computed(() => {
    const rest = this.blockers().slice(WAITS_VISIBLE);
    return rest.length === 0 ? null : { count: rest.length, name: this.t('more', { ids: rest.map((b) => b.id).join(', ') }) };
  });
  protected readonly metaText = computed(() => (this.meta() ? this.scope() : null));
}
