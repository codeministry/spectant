import { areaById, areaPath, specLink } from '../shell/areas';

/**
 * The notes pill's link, shared by the spec head and the zen footer: the Notes area of the spec the route names, or
 * null while no workspace or spec is open.
 */
export const notesLinkOf = (ws: string | null, id: string | null): string[] | null =>
  ws === null || id === null ? null : specLink(ws, id, areaPath(areaById('notes')));
