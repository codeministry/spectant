import type { Stage } from '../../../../../../core/src/stage';
import type { GraphLens, LensEdge, LensNode, RelationRef } from '../../../../../../core/src/relations';
import { CARD_EDGE } from '../../board/board-card';
import { DIAGRAM_CSS } from '../../../shared/ui/doc-prose/mermaid';

/** The words the mermaid text needs from the catalogue; the view hands them in, so this file stays pure. */
export interface GraphLabels {
  readonly noMilestone: string;
  readonly archived: string;
  readonly stage: (stage: Stage) => string;
  readonly bundle: (kind: 'done' | 'no-spec', count: number) => string;
  /** The name of the lane a ghost node stands in (`024 ↗ Pro`): its milestone's title, or the no-milestone word. */
  readonly lane: (lane: RelationRef | null) => string;
}

/**
 * A text for a quoted mermaid label: `#` first (it starts mermaid's entity codes), then every character that could
 * close the quote, open markup or start a markdown string becomes its entity code. Mermaid decodes them for display.
 */
export function escapeLabel(text: string): string {
  return text
    .replace(/#/gu, '#35;')
    .replace(/"/gu, '#quot;')
    .replace(/&/gu, '#amp;')
    .replace(/</gu, '#lt;')
    .replace(/>/gu, '#gt;')
    .replace(/`/gu, '#96;');
}

const cut = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);
const pair = (n: { closed: number; total: number }): string => `${String(n.closed)}/${String(n.total)}`;
const idOf = (ref: string | null): string => (ref === null ? '' : ref.slice(ref.indexOf(':') + 1));

/** The two lines a node shows (the second may be empty), already escaped and joined with mermaid's line break. */
export function nodeLines(node: LensNode, labels: GraphLabels): readonly [string, string] {
  switch (node.kind) {
    case 'milestone':
      return node.ref === null ? [labels.noMilestone, ''] : [`${node.title ?? ''} · ${pair(node)}`, ''];
    case 'feature':
      return [`${idOf(node.ref)} ${cut(node.title ?? '', 24)}`, pair(node)];
    case 'spec':
      if (node.ghost === true) return [`${idOf(node.ref)} ↗ ${labels.lane(node.lane)}`, cut(node.title ?? '', 24)];
      return [`${idOf(node.ref)} · ${node.archived === true ? labels.archived : node.stage ? labels.stage(node.stage) : ''}`, cut(node.title ?? '', 24)];
    case 'bundle':
      return [labels.bundle(node.bundle ?? 'done', node.members?.length ?? 0), pair(node)];
  }
}

/** The mermaid shape of a node kind: a stadium for a milestone, rounded for a spec, a rectangle otherwise. */
const SHAPE: Readonly<Record<LensNode['kind'], readonly [string, string]>> = {
  milestone: ['([', '])'],
  feature: ['[', ']'],
  spec: ['(', ')'],
  bundle: ['[', ']'],
};

/** The CSS classes a node carries in the SVG (`class <id> <name>` statements); styled by `GRAPH_CSS`. */
export function nodeClasses(node: LensNode): string[] {
  const classes = [`n-${node.kind}`];
  if (node.kind === 'milestone' && node.ref === null) classes.push('n-none');
  if (node.kind === 'spec') classes.push(node.archived === true ? 'n-archived' : `st-${node.stage ?? 'none'}`);
  if (node.ghost === true) classes.push('n-ghost');
  if (node.kind === 'bundle') classes.push(`b-${node.bundle ?? 'done'}`);
  return classes;
}

/**
 * The spec-edge arrows of a lens by the mermaid edge id the source gives them (`se0`, `se1`, … in edge order): mermaid
 * writes that id as the drawn path's `data-id`, so the view finds each arrow again to give it its state and its name.
 */
export function specEdgeIds(lens: GraphLens): ReadonlyMap<string, LensEdge> {
  return new Map(lens.edges.filter((e) => e.kind === 'spec-edge').map((e, i) => [`se${String(i)}`, e]));
}

/**
 * The mermaid source of one graph lens (spec 026, ISC-170): `flowchart LR` over the lens's nodes in drawing order and
 * its edges, one `subgraph` per milestone when more than one lane is drawn (`Alle`), each node with its kind's shape and
 * classes. Containment is a line without head (`---`); a spec edge (spec 025, ISC-170.1) is an arrow with its own edge
 * id (`specEdgeIds`), dotted while open (`-.->`), solid once met (`-->`). Exactly one definition line per node and one
 * link line per edge: the count of ISC-170 can be read off this text.
 */
export function graphSource(lens: GraphLens, labels: GraphLabels): string {
  const lines = ['flowchart LR'];
  const lanes = lens.nodes.filter((n) => n.kind === 'milestone');
  const grouped = lanes.length > 1;
  let open = false;
  for (const node of lens.nodes) {
    if (grouped && node.kind === 'milestone') {
      if (open) lines.push('  end');
      lines.push(`  subgraph c${node.id}["${escapeLabel(node.ref === null ? labels.noMilestone : (node.title ?? ''))}"]`);
      // A subgraph lays out top-down unless told otherwise: keep the three ranks left to right in every cluster.
      lines.push('    direction LR');
      open = true;
    }
    const [first, second] = nodeLines(node, labels);
    const text = second === '' ? escapeLabel(first) : `${escapeLabel(first)}<br/>${escapeLabel(second)}`;
    const [l, r] = SHAPE[node.kind];
    lines.push(`  ${node.id}${l}"${text}"${r}`);
  }
  if (open) lines.push('  end');
  const ids = new Map([...specEdgeIds(lens)].map(([id, edge]) => [edge, id]));
  for (const edge of lens.edges) {
    const id = ids.get(edge);
    lines.push(id === undefined ? `  ${edge.from} --- ${edge.to}` : `  ${edge.from} ${id}@${edge.state === 'met' ? '-->' : '-.->'} ${edge.to}`);
  }
  for (const node of lens.nodes) for (const name of nodeClasses(node)) lines.push(`  class ${node.id} ${name}`);
  return lines.join('\n');
}

const STROKE = ':is(rect, path, polygon)';

/**
 * Appended to mermaid's own `#id`-scoped sheet (after `DIAGRAM_CSS`), where it outranks mermaid's node rules; every
 * colour is a token, so it follows a theme switch. Spec nodes take their stage's card edge (`CARD_EDGE`), archived
 * specs and bundles a dashed stroke, the selected node (`data-selected="node"`) 2 px `--color-primary`. No filter,
 * no shadow (`web/tests/no-glow.test.ts`).
 */
export const GRAPH_CSS = [
  DIAGRAM_CSS,
  `.node ${STROKE} { fill: var(--color-base-100); stroke: var(--line); stroke-width: 1px; }`,
  `.node.n-milestone ${STROKE} { fill: var(--disp-t); stroke: var(--color-primary); }`,
  `.node.n-feature ${STROKE} { fill: var(--lane); }`,
  ...Object.entries(CARD_EDGE).map(([stage, edge]) => `.node.st-${stage} ${STROKE} { stroke: ${edge}; stroke-width: 1.5px; }`),
  `.node:is(.n-archived, .n-bundle, .n-none, .n-ghost) ${STROKE} { stroke: var(--track); stroke-dasharray: 5 4; }`,
  `.node:is(.n-bundle, .n-ghost) ${STROKE} { fill: transparent; }`,
  `.node.b-done ${STROKE} { stroke: var(--color-accent); }`,
  '.node:is(.n-archived, .n-bundle, .n-ghost) .nodeLabel { color: var(--muted); }',
  '.node[role="button"] { cursor: pointer; }',
  `.node:is([data-selected="node"], :focus-visible) ${STROKE} { stroke: var(--color-primary); stroke-width: 2px; }`,
  '.node:focus-visible { outline: none; }',
  '.cluster rect { fill: var(--lane); stroke: var(--line); rx: 12px; }',
  '.flowchart-link { stroke: var(--track); stroke-width: 1px; }',
  // Spec edges (spec 025, ISC-170.1), marked by the view (`data-spec-edge`): open in the waits chip's violet, dashed;
  // met muted and solid. Each points at its own copy of mermaid's arrowhead in the same colour (`data-spec-edge-marker`).
  '.flowchart-link[data-spec-edge="open"] { stroke: var(--color-secondary); stroke-width: 2px; stroke-dasharray: 6 4; }',
  '.flowchart-link[data-spec-edge="met"] { stroke: var(--muted); stroke-width: 1.5px; stroke-dasharray: none; }',
  'marker[data-spec-edge-marker="open"] path { fill: var(--color-secondary); stroke: var(--color-secondary); stroke-dasharray: none; }',
  'marker[data-spec-edge-marker="met"] path { fill: var(--muted); stroke: var(--muted); stroke-dasharray: none; }',
].join(' ');
