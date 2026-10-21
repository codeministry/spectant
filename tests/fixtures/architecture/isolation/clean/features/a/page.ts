import { clock } from "../../core/clock";
import { format } from "../../shared/format.ts";
import { part } from "./part";
import { deep } from "./sub/deep";

// Fixture for the isolation rule (spec 061, ISC-431): feature a imports core, shared and its own folder.
export const page = format([clock, part, deep].join(" "));
export const lazy = () => import("./sub/deep").then((m) => m.deep);
