// The tech page (spec 023, ISC-134), ported from the old skill's tech documentation: `specs/tech.md` with its four
// `<!-- section: key -->` markers as three documents (overview and stack joined), and per spec its goal, the first
// paragraph of its approach and its open fog. Browser-safe: no file system, the caller passes the texts in; malformed
// input becomes a FileDiagnostic, never a throw. Markers go through `tldr.ts`'s marker reader, frontmatter through
// `frontmatter.ts`, the goal and approach sections through `archive.ts`'s section reader, fog lines through
// `claims.ts`, and rendering through `markdown-docs.ts`, so this module adds no second parser of any of them.
import { firstParagraph, GOAL_HEADINGS, levelTwoSection } from './archive.ts';
import { parseClaims } from './claims.ts';
import type { Diagnostic } from './diagnostics.ts';
import type { DocsPage, FileDiagnostic, SpecFiles, TechInput, TechModel, TechSpec } from './files.ts';
import { parseFrontmatter } from './frontmatter.ts';
import { renderDocsMarkdown, type DocsOptions } from './markdown-docs.ts';
import { specIdOf } from './spec-ref.ts';
import { sectionsByMarker } from './tldr.ts';

/** The file from the repository root, as every diagnostic names it. */
const TECH_FILE = 'specs/tech.md';

/** The markdown of each of tech.md's four section keys; a missing key is empty text (and one warning). */
interface TechSections {
  readonly overview: string;
  readonly stack: string;
  readonly architecture: string;
  readonly risks: string;
}

type TechKey = keyof TechSections;

/** The heading of plan.md's approach section. */
const APPROACH_HEADINGS: readonly string[] = ['Approach'];

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
  const plan = f.texts.plan;
  const approach = plan === undefined ? null : levelTwoSection(plan, APPROACH_HEADINGS);
  return {
    id,
    slug: f.folder,
    type: specType,
    phase,
    goal: pageOf(levelTwoSection(spec, GOAL_HEADINGS), `spec-${id}-goal-`),
    approach: pageOf(approach === null ? null : firstParagraph(approach), `spec-${id}-approach-`),
    fog: phase === 'complete' ? [] : parseClaims(spec).fog.map((line) => line.text),
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
