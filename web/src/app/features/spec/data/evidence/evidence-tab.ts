import {
  ChangeDetectionStrategy,
  Component,
  computed,
  type ElementRef,
  inject,
  model,
  resource,
  signal,
  viewChild,
  ViewEncapsulation,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import type { EvidenceFile, EvidenceListing } from '../../../../../../../core/src/files';
import { renderMarkdown } from '../../../../../../../core/src/markdown';
import { specRoutes } from '../../../../../../../server/src/spec-routes.contract';
import { ApiClient } from '../../../../core/api.service';
import { ShellState } from '../../../../layout/shell/shell-state.service';
import { UiIcon } from '../../../../shared/icons/icon';
import type { IconName } from '../../../../shared/icons/icons';
import { UiIconButton } from '../../../../shared/ui/button/icon-button';
import { UiChip } from '../../../../shared/ui/chip/chip';
import { UiEmptyState } from '../../../../shared/ui/empty-state/empty-state';
import { modalDialog } from '../../../../shared/ui/overlay/modal';

/** How a file previews: an image, markdown rendered by core, text as it is, or not at all (a download row). */
type PreviewKind = 'image' | 'markdown' | 'text' | 'none';
/** Why a file shows as an error row: refused by confinement (listing or 403), or any other failed read. */
type FileError = 'refused' | 'failed';

/** The prototype's two evidence groups: `Results artifacts/` (cards) and `Raw evidence .evidence/` (rows). */
interface EvidenceGroupView {
  readonly key: 'results' | 'raw';
  readonly folder: string;
  readonly files: readonly EvidenceFile[];
}

type Preview =
  | { readonly kind: 'image'; readonly file: EvidenceFile; readonly url: string }
  | { readonly kind: 'markdown'; readonly file: EvidenceFile; readonly html: SafeHtml }
  | { readonly kind: 'text'; readonly file: EvidenceFile; readonly text: string };

export function previewKind(file: EvidenceFile): PreviewKind {
  if (file.mediaType.startsWith('image/')) return 'image';
  if (file.mediaType === 'text/markdown') return 'markdown';
  if (file.mediaType === 'text/plain' || file.mediaType === 'application/json') return 'text';
  return 'none';
}

/** Prototype `h.I("file")`: every file that is not shown as its image carries the one file icon. */
const ICON: Record<PreviewKind, IconName> = { image: 'image', markdown: 'file', text: 'file', none: 'file' };

/**
 * The Evidence tab (ISC-83.1, spec 024 prototype `tabEvidence`): the spec's files in the prototype's two groups,
 * `Results artifacts/` as a card grid (image or file icon, name in mono, task · claim · size) and `Raw evidence
 * .evidence/` as rows (image or file icon, name in mono, the claim as a `take` chip). Every file carries the claim core's
 * `listEvidence` gave it as a chip that links to the claim card in the Claims tab (`data-claim`, `none` without one). A thumbnail or a markdown (or text) row opens one full-screen
 * native `<dialog>` driven by the modal primitive, with the path, the content fitted to width and a 44 px close
 * button. Markdown renders through core's one renderer (`core/src/markdown.ts`), never a second one.
 *
 * A refused file — flagged `refused` by the listing, or answered 403 by `…/evidence/file` — is an error row and never
 * a fallback preview (ISC-83). The file URL is the contract's builder over the listing's raw `path`, encoded once.
 *
 * Not encapsulated: the rendered markdown is `[innerHTML]`; every selector in the stylesheet starts with
 * `app-evidence-tab`, as the Docs tab does.
 */
@Component({
  selector: 'app-evidence-tab',
  imports: [RouterLink, TranslocoPipe, UiChip, UiEmptyState, UiIcon, UiIconButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  host: { 'data-view': 'evidence' },
  templateUrl: './evidence-tab.html',
  styleUrl: './evidence-tab.css',
})
export class EvidenceTab {
  private readonly api = inject(ApiClient);
  private readonly shell = inject(ShellState);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly transloco = inject(TranslocoService);
  // Read by `size()`, so a language switch re-formats the numbers.
  private readonly translation = toSignal(this.transloco.selectTranslation());

  protected readonly icon = ICON;
  protected readonly previewKind = previewKind;

  private readonly params = computed(() => {
    const ws = this.shell.ws();
    const id = this.shell.specId();
    return ws !== null && id !== null ? { ws, id } : undefined;
  });

  private readonly listing = resource({
    params: () => this.params(),
    loader: ({ params }) => this.api.evidence(params.ws, params.id),
  });

  // `value()` throws while the resource is in its error state, so every read goes through `hasValue()` first.
  private readonly result = computed(() => (this.listing.hasValue() ? this.listing.value() : undefined));
  protected readonly model = computed<EvidenceListing | null>(() => {
    const result = this.result();
    return result?.kind === 'ok' ? result.body : null;
  });
  protected readonly failed = computed(() => {
    const result = this.result();
    return this.listing.error() !== undefined || (result !== undefined && result.kind !== 'ok');
  });

  /** Core's two folders as it lists them (`results` = `artifacts/`, `raw` = `.evidence/`), each by path. */
  protected readonly groups = computed<readonly EvidenceGroupView[]>(() => {
    const model = this.model();
    if (!model) return [];
    const groups: EvidenceGroupView[] = [];
    if (model.results.length > 0) groups.push({ key: 'results', folder: 'artifacts/', files: model.results });
    if (model.raw.length > 0) groups.push({ key: 'raw', folder: '.evidence/', files: model.raw });
    return groups;
  });

  /** The Claims tab, where a file's claim chip lands on `#claim-<id>`. */
  protected readonly claimsLink = computed(() => {
    const params = this.params();
    return params ? ['/w', params.ws, 's', params.id, 'claims'] : null;
  });

  protected isImage(file: EvidenceFile): boolean {
    return previewKind(file) === 'image' && !file.refused;
  }

  /** The card's meta line: task · claim · size (prototype `T12 · ISC-330 · 4.2 KB`). */
  protected meta(file: EvidenceFile): string {
    return [file.task, this.size(file.bytes)].filter((part) => part !== null).join(' · ');
  }

  /** Files that became an error row on a read (403 or a failed image), keyed by path. */
  private readonly errors = signal<ReadonlyMap<string, FileError>>(new Map());
  private readonly loading = signal<string | null>(null);

  protected errorOf(file: EvidenceFile): FileError | null {
    return file.refused ? 'refused' : (this.errors().get(file.path) ?? null);
  }

  protected isLoading(file: EvidenceFile): boolean {
    return this.loading() === file.path;
  }

  /** `GET …/evidence/file?path=`: the contract's builder, the listing's path encoded exactly once. */
  protected fileUrl(file: EvidenceFile): string {
    const params = this.params();
    return params ? specRoutes.evidenceFile(params.ws, params.id, file.path) : '';
  }

  protected size(bytes: number): string {
    this.translation();
    const lang = this.transloco.getActiveLang();
    const [value, unit] = bytes < 1024 ? [bytes, 'b'] : bytes < 1024 * 1024 ? [bytes / 1024, 'kb'] : [bytes / 1024 / 1024, 'mb'];
    const formatted = new Intl.NumberFormat(lang, { maximumFractionDigits: unit === 'b' ? 0 : 1 }).format(value);
    return this.transloco.translate(`evidence.size.${unit}`, { value: formatted });
  }

  // ─── Preview ─────────────────────────────────────────────────────────────────────────────────────────────────

  protected readonly previewOpen = model(false);
  protected readonly preview = signal<Preview | null>(null);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  protected readonly modal = modalDialog(this.previewOpen, this.dialog);

  protected openImage(file: EvidenceFile): void {
    this.preview.set({ kind: 'image', file, url: this.fileUrl(file) });
    this.previewOpen.set(true);
  }

  protected imageFailed(file: EvidenceFile): void {
    this.markError(file, 'failed');
  }

  /** Reads a markdown or text file, then opens it; a 403 or a failed read turns its row into an error row instead. */
  protected async openText(file: EvidenceFile): Promise<void> {
    const params = this.params();
    if (!params || this.loading() !== null) return;
    this.loading.set(file.path);
    const answer = await this.api.evidenceText(params.ws, params.id, file.path);
    this.loading.set(null);
    if (answer.kind !== 'ok') {
      this.markError(file, answer.kind === 'refused' ? 'refused' : 'failed');
      return;
    }
    if (previewKind(file) === 'markdown') {
      // Trusted on purpose: core's renderer escapes every text and raw HTML block and emits only its own tags
      // (the same reasoning as the Docs tab); the string is never built from anything else.
      const { html } = renderMarkdown(answer.text, { idPrefix: 'evidence-preview-' });
      this.preview.set({ kind: 'markdown', file, html: this.sanitizer.bypassSecurityTrustHtml(html) });
    } else {
      this.preview.set({ kind: 'text', file, text: answer.text });
    }
    this.previewOpen.set(true);
  }

  protected close(): void {
    this.previewOpen.set(false);
  }

  private markError(file: EvidenceFile, error: FileError): void {
    this.errors.update((map) => new Map(map).set(file.path, error));
  }
}
