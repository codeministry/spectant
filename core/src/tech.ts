// The tech page (spec 023, ISC-134), ported from the old skill's tech documentation: `specs/tech.md` with its four
// `<!-- section: key -->` markers as three documents (overview and stack joined), and per spec its title, its goal,
// the first paragraph of its approach and its open fog. Browser-safe: no file system, the caller passes the texts in;
// malformed input becomes a FileDiagnostic, never a throw. Markers go through `tldr.ts`'s marker reader, frontmatter
// through `frontmatter.ts`, the title through `archive.ts`'s listing (as the dashboard row takes it), the goal and
// approach sections through `archive.ts`'s section reader, fog lines through `claims.ts`, and rendering through
// `markdown-docs.ts`, so this module adds no second parser of any of them.
import { firstParagraph, GOAL_HEADINGS, levelTwoSection, listArchive, specTitle } from './archive.ts';
import { parseClaims } from './claims.ts';
import type { Diagnostic } from './diagnostics.ts';
import type { DocsPage, FileDiagnostic, SpecFiles, TechInput, TechModel, TechSpec } from './files.ts';
import { parseFrontmatter } from './frontmatter.ts';
import { renderDocsMarkdown, type DocsOptions } from './markdown-docs.ts';
import { specIdOf } from './spec-ref.ts';
import { MARKER, sectionsByMarker } from './tldr.ts';

/** The file from the repository root, as every diagnostic names it. */
const TECH_FILE = 'specs/tech.md';

/** The markdown of each of tech.md's four section keys; a missing key is empty text (and one warning). */
interface TechSections {
  readonly overview: string;
  readonly stack: string;
  readonly architecture: string;
  readonly risks: string;
}

/** One of tech.md's four section keys. */
export type TechSectionKey = keyof TechSections;
type TechKey = TechSectionKey;

/** The heading of plan.md's approach section; the library's group heads read it too (spec 017). */
export const APPROACH_HEADINGS: readonly string[] = ['Approach'];

/**
 * The Markdown sources the tech page renders for one spec, before rendering: the `## Goal` section trimmed, the first
 * paragraph of plan.md's `## Approach`, each null when there is no prose, and the `- fog:` lines, none for a spec whose
 * phase is `complete`. The library's group heads and open fog lines (spec 017, ISC-157) take the same values.
 */
export interface TechSources {
  readonly goal: string | null;
  readonly approach: string | null;
  readonly fog: readonly string[];
}

const proseOrNull = (text: string | null): string | null => {
  const trimmed = text?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
};

/** One spec's tech sources from its spec.md and plan.md texts. */
export function techSourcesOf(spec: string, plan: string | undefined): TechSources {
  const approach = plan === undefined ? null : levelTwoSection(plan, APPROACH_HEADINGS);
  return {
    goal: proseOrNull(levelTwoSection(spec, GOAL_HEADINGS)),
    approach: proseOrNull(approach === null ? null : firstParagraph(approach)),
    fog: parseFrontmatter(spec).data.phase === 'complete' ? [] : parseClaims(spec).fog.map((line) => line.text),
  };
}

/**
 * Whether an image path, as written in tech.md, stays inside `specs/` once resolved against it: no absolute path, no
 * backslash, and no `..` that climbs above the folder, read both as written and decoded once (as the route decodes).
 */
function insideSpecs(src: string): boolean {
  let decoded: string;
  try {
    decoded = decodeURIComponent(src);
  } catch {
    return false;
  }
  return [src, decoded].every((path) => {
    if (path.startsWith('/') || path.includes('\\')) return false;
    let depth = 0;
    for (const segment of path.split('/')) {
      if (segment === '..') depth -= 1;
      else if (segment !== '' && segment !== '.') depth += 1;
      if (depth < 0) return false;
    }
    return true;
  });
}

/** Render options for a tech.md page: ids prefixed per page, and an image outside `specs/` flagged missing (no `<img>`). */
function techOptions(page: string, input: TechInput): DocsOptions {
  const exists = input.assetExists;
  return {
    idPrefix: `tech-${page}-`,
    // Every image tech.md names loads through the tech asset route (`data-spec-asset`, path relative to `specs/`).
    specAssets: ['*'],
    assetExists: (src, asset) => insideSpecs(src) && (exists === undefined || exists(src, asset)),
  };
}

/** One section marker per key; each key the file leaves out reads as empty and warns once, the key as subject. */
function techSections(body: string, diagnostics: FileDiagnostic[]): TechSections {
  const found = sectionsByMarker(body);
  const text = (key: TechKey): string => {
    if (Object.hasOwn(found, key)) return found[key] ?? '';
    const diagnostic: Diagnostic = {
      severity: 'warning',
      code: 'tech-section',
      message: `${TECH_FILE} has no \`<!-- section: ${key} -->\` marker, so its ${key} section is empty.`,
      subject: key,
    };
    diagnostics.push({ file: TECH_FILE, diagnostic });
    return '';
  };
  return { overview: text('overview'), stack: text('stack'), architecture: text('architecture'), risks: text('risks') };
}

/** tech.md's four section keys in contract order, the order tech.md holds them and the library shows them. */
export const TECH_SECTION_KEYS: readonly TechKey[] = ['overview', 'stack', 'architecture', 'risks'];

/** One section of tech.md as its marker names it: the key and the text of the first `##` heading inside it, or null. */
export interface TechSectionHead {
  readonly key: TechKey;
  readonly heading: string | null;
}

/**
 * The four sections of a tech.md text in contract order (spec 017), each with the first level-two heading inside its
 * `<!-- section: key -->` marker as the renderer's contents list names it, so a reader selecting sections by heading
 * reads core's marker split instead of guessing from h2 names or positions. Frontmatter and markers go through the
 * same readers as `readTech`; a key without a marker reads null, as `readTech` reads its section empty.
 */
export function techSectionHeads(tech: string): readonly TechSectionHead[] {
  const found = sectionsByMarker(parseFrontmatter(tech).body);
  return TECH_SECTION_KEYS.map((key): TechSectionHead => {
    const text = Object.hasOwn(found, key) ? (found[key] ?? '') : '';
    const head = text === '' ? undefined : renderDocsMarkdown(text).toc.find((entry) => entry.level === 2);
    return { key, heading: head?.text ?? null };
  });
}

/** The attribute of the `<section>` that holds one marker's part of tech.md in the library's page (spec 057, ISC-355). */
export const TECH_PART_ATTRIBUTE = 'data-tech-part';

/** What a marker becomes while the file renders: one paragraph of letters and digits that no tech.md writes. */
const PART_TOKEN = 'spectanttechpart7f3c9e';

/**
 * tech.md as the library serves it (spec 057, ISC-355): the whole file rendered once, as `renderDocsMarkdown` renders
 * it, with each marker's part wrapped in `<section data-tech-part="key">` in file order, so the reader takes its
 * sections from the markers, as `readTech` reads them, and never from an h2: text before the first marker stays
 * outside every part, a repeated key is two parts of the same key, and a part without a heading is still a part. Each
 * marker renders as a token paragraph that is cut out again; the token closes the block before it, as the marker
 * closes readTech's section. Should a token not come out as its own paragraph (a marker inside an unclosed code
 * fence), the file renders as it is, without parts: the reader then shows no section rather than a wrong one.
 */
export function renderTechDocument(tech: string, options?: DocsOptions): DocsPage {
  const body = parseFrontmatter(tech).body;
  const plainPage = (): DocsPage => renderDocsMarkdown(tech, options);
  if (!tech.endsWith(body)) return plainPage();
  const keys: string[] = [];
  const marked = body.replace(new RegExp(MARKER.source, 'g'), (_marker, key: string) => `\n\n${PART_TOKEN}${keys.push(key) - 1}\n\n`);
  if (keys.length === 0) return plainPage();
  const page = renderDocsMarkdown(tech.slice(0, tech.length - body.length) + marked, options);
  const pieces = page.html.split(new RegExp(`<p>${PART_TOKEN}(\\d+)</p>`));
  const order = pieces.filter((_, i) => i % 2 === 1);
  if (order.length !== keys.length || order.some((n, i) => n !== String(i))) return plainPage();
  const parts = keys.map((key, i) => `<section ${TECH_PART_ATTRIBUTE}="${key}">${pieces[2 * i + 2] ?? ''}</section>`);
  return { ...page, html: (pieces[0] ?? '') + parts.join(''), wordCount: page.wordCount - keys.length };
}

/** A section's markdown as a document, or null when there is no prose to render. */
function pageOf(markdown: string | null, idPrefix: string): DocsPage | null {
  const text = markdown?.trim() ?? '';
  return text === '' ? null : renderDocsMarkdown(text, { idPrefix });
}

/** One spec folder as the page lists it; a folder without spec.md is not a spec (the dashboard says so) and is skipped. */
function techSpec(f: SpecFiles): TechSpec | null {
  const spec = f.texts.spec;
  if (spec === undefined) return null;
  const id = specIdOf(f.folder) ?? f.folder;
  const { specType, phase } = parseFrontmatter(spec).data;
  const sources = techSourcesOf(spec, f.texts.plan);
  return {
    id,
    slug: f.folder,
    // The dashboard row's title, derived as `dashboard.ts` does: the archive listing's summary of the folder.
    title: specTitle(listArchive([f])[0], f.folder),
    type: specType,
    phase,
    goal: pageOf(sources.goal, `spec-${id}-goal-`),
    approach: pageOf(sources.approach, `spec-${id}-approach-`),
    fog: [...sources.fog],
  };
}

/** The numeric order of the folders, the folder name breaking a tie; a folder without a number sorts last. */
function byNumber(a: TechSpec, b: TechSpec): number {
  const n = (s: TechSpec): number => (/^\d+$/.test(s.id) ? Number(s.id) : Number.POSITIVE_INFINITY);
  return n(a) - n(b) || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0);
}

/** Reads `specs/tech.md` and the spec folders into the tech page's model. An absent tech.md is `pages: null`, no warning. */
export function readTech(input: TechInput): TechModel {
  const diagnostics: FileDiagnostic[] = [];
  let pages: TechModel['pages'] = null;
  if (input.tech !== undefined) {
    const fm = parseFrontmatter(input.tech);
    for (const diagnostic of fm.diagnostics) diagnostics.push({ file: TECH_FILE, diagnostic });
    const s = techSections(fm.body, diagnostics);
    const join = [s.overview, s.stack].filter((part) => part !== '').join('\n\n');
    pages = {
      overview: renderDocsMarkdown(join, techOptions('overview', input)),
      architecture: renderDocsMarkdown(s.architecture, techOptions('architecture', input)),
      risks: renderDocsMarkdown(s.risks, techOptions('risks', input)),
    };
  }
  const specs = input.specs.flatMap((f) => techSpec(f) ?? []).sort(byNumber);
  return { pages, diagnostics, specs };
}
