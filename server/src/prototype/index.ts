/**
 * The `prototype/` slice's one public surface (spec 017, spec 059): `GET`/`HEAD /proto/:ws/:spec/:folder/*`, as the
 * router's family, its handler and alone.
 */
export { PROTOTYPE_FAMILY, type PrototypeApiOptions, type PrototypeFamilyMatch, prototypeApi, prototypeHandlers } from "./routes.ts";
