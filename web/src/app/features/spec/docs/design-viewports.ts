/**
 * The Design tab's viewport cards (spec 024, ISC-149; prototype `tabDesign`): one card per `##` section of design.md
 * that holds an Ist and a Soll `###` subsection, with the first screenshot of each and the Soll's first paragraph.
 *
 * Read from core's rendered page, never from the Markdown: core stays the one parser of the format, this only finds
 * its sections in the sanitised HTML (`DocsPage.html`) the prose below shows in full.
 */

/** One screenshot of a viewport card: the spec-folder path core put on the image (`data-spec-asset`). */
export interface DesignShot {
  readonly path: string;
  readonly alt: string;
}

export interface DesignViewport {
  /** The `##` heading's anchor, so the card links into the prose. */
  readonly id: string;
  /** The heading without its width, `Mobile` for `Mobile (390)`. */
  readonly name: string;
  /** The width the heading names (`390`), null when it names none. */
  readonly width: string | null;
  readonly ist: DesignShot | null;
  readonly soll: DesignShot | null;
  /** The Soll subsection's first paragraph or list item as plain text; empty when it has none. */
  readonly sollText: string;
}

const IST = /^(ist|current|now|before|as[- ]is)\b/iu;
const SOLL = /^(soll|target|after|to[- ]be|should)\b/iu;
const WIDTH = /\s*[(·-]?\s*(\d{3,4})\s*(?:px)?\s*\)?\s*$/u;

/** The viewport cards of a rendered design.md; empty when no `##` section pairs an Ist with a Soll. */
export function designViewports(html: string): DesignViewport[] {
  if (typeof DOMParser === 'undefined') return [];
  const body = new DOMParser().parseFromString(html, 'text/html').body;
  const out: DesignViewport[] = [];
  let current: { id: string; heading: string; sub: Map<'ist' | 'soll', Element[]>; at: 'ist' | 'soll' | null } | null = null;
  const flush = (): void => {
    if (current === null) return;
    const ist = current.sub.get('ist');
    const soll = current.sub.get('soll');
    if (ist !== undefined && soll !== undefined) {
      const match = WIDTH.exec(current.heading);
      out.push({
        id: current.id,
        name: match ? current.heading.slice(0, match.index).trim() || current.heading : current.heading,
        width: match?.[1] ?? null,
        ist: firstShot(ist),
        soll: firstShot(soll),
        sollText: firstText(soll),
      });
    }
    current = null;
  };
  for (const node of Array.from(body.children)) {
    const tag = node.tagName;
    if (tag === 'H1' || tag === 'H2') {
      flush();
      if (tag === 'H2') current = { id: node.id, heading: node.textContent.trim(), sub: new Map(), at: null };
      continue;
    }
    if (current === null) continue;
    if (tag === 'H3') {
      const text = node.textContent.trim();
      current.at = IST.test(text) ? 'ist' : SOLL.test(text) ? 'soll' : null;
      if (current.at !== null && !current.sub.has(current.at)) current.sub.set(current.at, []);
      continue;
    }
    if (current.at !== null) current.sub.get(current.at)?.push(node);
  }
  flush();
  return out;
}

function firstShot(nodes: readonly Element[]): DesignShot | null {
  for (const node of nodes) {
    const img = node.matches('img[data-spec-asset]') ? node : node.querySelector('img[data-spec-asset]');
    const path = img?.getAttribute('data-spec-asset');
    if (img && path) return { path, alt: img.getAttribute('alt') ?? '' };
  }
  return null;
}

function firstText(nodes: readonly Element[]): string {
  for (const node of nodes) {
    if (node.tagName !== 'P' && node.tagName !== 'UL' && node.tagName !== 'OL') continue;
    const target = node.tagName === 'P' ? node : node.querySelector('li');
    const text = (target?.textContent ?? '').replace(/\s+/gu, ' ').trim();
    if (text !== '') return text;
  }
  return '';
}
