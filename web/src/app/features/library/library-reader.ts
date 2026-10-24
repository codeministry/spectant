import { afterRenderEffect, ChangeDetectionStrategy, Component, computed, DestroyRef, ElementRef, inject, input, output, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import type { LibraryDoc } from '../../../../../core/src/files';
import { UiIcon } from '../../shared/icons/icon';
import type { OpenKey } from '../../shared/open-state';
import { UiDisclosure, UiDisclosureDescription } from '../../shared/ui/overlay/disclosure';
import { UiTimeLabel } from '../../shared/time';
import { UiButton } from '../../shared/ui/button/button';
import { UiChip } from '../../shared/ui/chip/chip';
import { UiCommandChip } from '../../shared/ui/command-chip/command-chip';
import { UiDocProse } from '../../shared/ui/doc-prose/doc-prose';
import { UiEmptyState } from '../../shared/ui/empty-state/empty-state';
import { UiNotice } from '../../shared/ui/notice/notice';
import { UiSkeleton } from '../../shared/ui/skeleton/skeleton';
import { UiSourceChip } from '../../shared/ui/source-chip/source-chip';
import { specKey, WORKSPACE_SPEC } from './library-model';
import { DECISIONS_SECTION, decisionsHeading, fileName, missingCommand, namesDecisions, type ReaderContext, typeIcon } from './library-prose';
import { LibraryReaderStore } from './library-reader.store';
import { type ReaderSection, sectionFor } from './library-sections';
import { PrototypeCard } from './prototype-card';

// The reader's pure parts moved to `library-prose.ts` (spec 061, T14); re-exported for this module's importers.
export { fileName, folderOf, missingCommand, type ProseLinks, type ReaderContext, resolveRelative, rewriteProse, techReading, typeIcon } from './library-prose';

/**
 * The library's reader (spec 017, T34, ISC-156.3; design.md 017 § 7 Reader, § 2 Reader, § Across viewports): the
 * head (type tag, spec chip, path, "updated …", the title and "Open in spec NNN"), the stale notice, and the body by the
 * document's media:
 * - Markdown through `ui-doc-prose` (`ApiClient.libraryDoc`): Docs prose with "On this page" (a sticky column at wide,
 *   a disclosure below), mermaid as a figure with its toolbar (ISC-154, ISC-154.1). Relative images load from the
 *   library's file route, `.design/` assets of a design document too; a relative link to another catalog document is
 *   a cross reference `[data-library-xref]` whose click selects that document (`pick`) without leaving the page, its
 *   `href` the library address with the current filters and the target's path as fragment.
 * - An image document as a preview `[data-library-preview]`: the image at its natural size up to the column, alt its
 *   title, from the same file route.
 * - A prototype as its card (`app-prototype-card`, T38, ISC-159): the page list, each page in a new tab on the server's
 *   read route, and the preview from the spec's `.design/`; a missing document is the empty state with the command
 *   that writes it.
 *
 * "Open in spec" leads to the spec dashboard and is left out for workspace-wide documents and in the spec context.
 * Below 1120 px the back button (and Escape) emits `back`; the page restores the list. The table of contents scrolls
 * in place: the library's fragment holds the document's path, so a heading anchor never replaces it. A section of
 * tech.md is named in the address beside it as `?section=<key>` (spec 017, T42: the former tech tabs Overview and
 * Architecture redirect there): once that section is drawn the reader scrolls to it and focuses its heading, once per
 * document and section, so a later filter change does not pull the page back.
 *
 * The state (the read, the sections, the open keys, the URLs) lives in `LibraryReaderStore`, one per reader (spec 061,
 * ISC-436); the component keeps the DOM work: drawn anchors, jumps, focus and the contents' clicks.
 */
@Component({
  selector: 'app-library-reader',
  imports: [
    PrototypeCard,
    RouterLink,
    TranslocoPipe,
    UiButton,
    UiChip,
    UiCommandChip,
    UiDisclosure,
    UiDisclosureDescription,
    UiDocProse,
    UiEmptyState,
    UiIcon,
    UiNotice,
    UiSkeleton,
    UiSourceChip,
    UiTimeLabel,
  ],
  providers: [LibraryReaderStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'lib-reader',
    'data-library-reader': '',
    tabindex: '-1',
    '[attr.aria-label]': 'label()',
    '[attr.data-context]': 'context()',
    '(click)': 'follow($event)',
    '(keydown.escape)': 'escape($event)',
  },
  templateUrl: './library-reader.html',
  styleUrl: './library-reader.css',
})
export class LibraryReader {
  private readonly store = inject(LibraryReaderStore);
  private readonly transloco = inject(TranslocoService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly translation = toSignal(this.transloco.selectTranslation());

  /** The workspace slug the routes name. */
  readonly workspace = input.required<string>();
  /** The document shown; null shows "Pick a document". */
  readonly doc = input<LibraryDoc | null>(null);
  /** The catalog's documents: a relative link to one of them is a cross reference. */
  readonly docs = input<readonly LibraryDoc[]>([]);
  readonly context = input<ReaderContext>('workspace');
  /** The wide tier: list and reader side by side, no back button. */
  readonly wide = input(false);

  /** The back button or Escape below 1120 px. */
  readonly back = output();
  /** A cross reference was followed: the catalog path of its document. */
  readonly pick = output<string>();

  /** The document and section the reader last jumped to, so the jump happens once per pair. */
  private jumped: string | null = null;

  protected readonly typeIcon = typeIcon;
  protected readonly missingCommand = missingCommand;
  protected readonly fileName = fileName;

  protected readonly label = computed(() => {
    this.translation();
    return this.transloco.translate('library.reader.label');
  });

  protected readonly loading = this.store.loading;
  protected readonly failed = this.store.failed;
  protected readonly prose = this.store.prose;
  protected readonly lead = this.store.lead;
  protected readonly sections = this.store.sections;
  protected readonly opened = this.store.opened;
  protected readonly techMissing = this.store.techMissing;
  protected readonly techAbsent = this.store.techAbsent;
  protected readonly techCommand = this.store.techCommand;
  protected readonly assetUrl = this.store.assetUrl;
  protected readonly preview = this.store.preview;
  protected readonly openLink = this.store.openLink;
  /** A contents jump waiting for its section to open: the section's id and the anchor to land on. */
  private readonly pending = signal<{ readonly section: string; readonly anchor: string } | null>(null);

  constructor() {
    this.store.connect({ workspace: this.workspace, doc: this.doc, docs: this.docs, context: this.context });
    // A cross reference's href follows the address's filters, set on the drawn anchors, so the prose is not redrawn.
    afterRenderEffect({
      write: () => {
        this.store.params();
        this.prose();
        for (const anchor of this.host.querySelectorAll<HTMLAnchorElement>('a[data-library-xref]')) {
          anchor.setAttribute('href', this.store.xrefHref(anchor.dataset['libraryXref'] ?? ''));
        }
      },
    });
    // `?section=` scrolls to that section of tech.md and focuses its heading once it is drawn (spec 017, T42).
    afterRenderEffect({
      write: () => {
        const section = this.store.section();
        this.prose();
        if (section === null) {
          this.jumped = null;
          return;
        }
        const key = `${this.doc()?.path ?? ''}#${section}`;
        if (this.jumped === key) return;
        // A spec.md drawn as sections: the Decisions section opens and takes the focus like a contents jump.
        const decisions = section === DECISIONS_SECTION ? this.sections().find((part) => namesDecisions(part.section.heading, part.section.id)) : undefined;
        if (decisions !== undefined) {
          this.jumped = key;
          untracked(() => this.jumpTo(decisions.section, decisions.section.id));
          return;
        }
        const heading =
          section === DECISIONS_SECTION
            ? decisionsHeading(this.host)
            : this.host.querySelector<HTMLElement>(`section[data-library-tech-section="${section}"] > h2, section[data-library-tech-section="${section}"][id]`);
        if (heading === null) return;
        this.jumped = key;
        heading.setAttribute('tabindex', '-1');
        heading.scrollIntoView({ block: 'start' });
        heading.focus({ preventScroll: true });
      },
    });
    // The table of contents scrolls in place, ahead of ui-doc-prose's own jump, which would put the heading's anchor
    // into the fragment that names the document (capture phase on the host: the link's own listener never runs).
    const toc = (event: MouseEvent): void => {
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('.docs-toc-list a[href^="#"]') : null;
      if (link === null || !this.host.contains(link)) return;
      event.preventDefault();
      event.stopPropagation();
      const anchor = (link.getAttribute('href') ?? '').slice(1);
      // Into a section (its own ## or a heading below it): the section opens first, then the jump lands (ISC-251).
      const split = this.store.split();
      const target = split === null ? null : sectionFor(split, anchor);
      if (target !== null) {
        this.jumpTo(target, anchor);
        return;
      }
      const heading = this.host.querySelector<HTMLElement>(`.docs-prose [id="${anchor.replaceAll('"', '')}"]`);
      if (heading === null) return;
      heading.setAttribute('tabindex', '-1');
      heading.scrollIntoView({ block: 'start' });
      heading.focus({ preventScroll: true });
    };
    // A pending jump lands once its section is drawn open (no longer inert): on the section's own toggle for its ##,
    // on the heading below it otherwise; scrolled to and focused, the focus in the arriving section (DS-APP-35).
    afterRenderEffect({
      write: () => {
        const pending = this.pending();
        const part = pending === null ? undefined : this.sections().find((entry) => entry.section.id === pending.section);
        if (pending === null || part === undefined || !this.opened().has(part.section.key)) return;
        const element = [...this.host.querySelectorAll<HTMLElement>('[data-library-section]')].find((el) => el.dataset['librarySection'] === pending.section);
        untracked(() => this.pending.set(null));
        if (element === undefined) return;
        const toggle = element.querySelector<HTMLElement>(':scope > .head .summary');
        const heading =
          pending.anchor === pending.section ? null : [...element.querySelectorAll<HTMLElement>('.docs-prose [id]')].find((el) => el.id === pending.anchor);
        const scrollTo = heading ?? element;
        const focus = heading ?? toggle;
        heading?.setAttribute('tabindex', '-1');
        scrollTo.scrollIntoView({ block: 'start' });
        focus?.focus({ preventScroll: true });
      },
    });
    this.host.addEventListener('click', toc, { capture: true });
    inject(DestroyRef).onDestroy(() => {
      this.host.removeEventListener('click', toc, { capture: true });
    });
  }

  /** The spec chip: the number, or the workspace for a workspace-wide document. */
  protected chipLabel(spec: string): string {
    return spec === WORKSPACE_SPEC ? this.store.wsName() : specKey(spec);
  }

  /** The document's file (or prototype folder) as the workspace names it: below `specs/`. */
  protected filePath(doc: Pick<LibraryDoc, 'path'>): string {
    return `specs/${doc.path}`;
  }

  /** A section toggled: the page's open sections go into `?open=` in one change (`openEntries`). */
  protected setOpen(key: OpenKey, open: boolean): void {
    this.store.setOpen(key, open);
  }

  /** Opens `section` if it is closed and lands on `anchor` in it once it is drawn open. */
  private jumpTo(section: ReaderSection, anchor: string): void {
    if (!this.opened().has(section.key)) this.setOpen(section.key, true);
    this.pending.set({ section: section.id, anchor });
  }

  /** A plain click on a cross reference selects its document in place; a modified click keeps the browser's way. */
  protected follow(event: MouseEvent): void {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[data-library-xref]') : null;
    const path = link?.dataset['libraryXref'];
    if (path === undefined) return;
    event.preventDefault();
    this.pick.emit(path);
  }

  /** Escape below 1120 px returns to the list, unless a dialog (the diagram's full screen) takes it. */
  protected escape(event: Event): void {
    if (this.wide() || this.doc() === null || event.defaultPrevented) return;
    if (event.target instanceof Element && event.target.closest('dialog') !== null) return;
    event.preventDefault();
    this.back.emit();
  }
}
