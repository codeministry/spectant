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
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import type { EvidenceFile, EvidenceListing } from '../../../../../../../core/src/files';
import { renderMarkdown } from '../../../../../../../core/src/markdown';
import { specRoutes } from '../../../../../../../server/src/spec-routes.contract';
import { ApiClient } from '../../../../core/api.service';
import { ShellState } from '../../../../layout/shell/shell-state.service';
import { UiIcon } from '../../../../shared/icons/icon';
import type { IconName } from '../../../../shared/icons/icons';
import { UiIconButton } from '../../../../shared/ui/button/icon-button';
import { UiEmptyState } from '../../../../shared/ui/empty-state/empty-state';
import { modalDialog } from '../../../../shared/ui/overlay/modal';

/** How a file previews: an image, markdown rendered by core, text as it is, or not at all (a download row). */
type PreviewKind = 'image' | 'markdown' | 'text' | 'none';
/** Why a file shows as an error row: refused by confinement (listing or 403), or any other failed read. */
type FileError = 'refused' | 'failed';

interface EvidenceGroupView {
  /** The claim ID, or `none` for the files no claim names. */
  readonly key: string;
  readonly claim: string | null;
  readonly images: readonly EvidenceFile[];
  readonly files: readonly EvidenceFile[];
  readonly count: number;
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

const ICON: Record<PreviewKind, IconName> = { image: 'layout-grid', markdown: 'book-open', text: 'file-text', none: 'archive' };

/**
 * The Evidence tab (ISC-83.1): the spec's `artifacts/` and `.evidence/` files as core's `listEvidence` groups them,
 * one open collapse per claim (the unclaimed files last). Images are a thumbnail grid, every other file a 56 px row
 * with its type icon, its name in mono and its size. A thumbnail or a markdown (or text) row opens one full-screen
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
  imports: [TranslocoPipe, UiEmptyState, UiIcon, UiIconButton],
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

  /** Core's grouping as it is: `byClaim` in the spec's claim order, then `ungrouped`. Nothing is re-derived here. */
  protected readonly groups = computed<readonly EvidenceGroupView[]>(() => {
    const model = this.model();
    if (!model) return [];
    const view = (key: string, claim: string | null, files: readonly EvidenceFile[]): EvidenceGroupView => {
      const isImage = (f: EvidenceFile) => previewKind(f) === 'image' && !f.refused;
      return { key, claim, images: files.filter(isImage), files: files.filter((f) => !isImage(f)), count: files.length };
    };
    const groups = Object.entries(model.byClaim).map(([claim, files]) => view(claim, claim, files));
    if (model.ungrouped.length > 0) groups.push(view('none', null, model.ungrouped));
    return groups;
  });

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
