import { widget } from "../b/widget";
import type { Shape } from "../b/shape.ts";

// Fixture for the isolation rule (spec 061, ISC-431): feature a imports feature b, a value and a type-only import.
export const page = (shape: Shape): string => `${widget} ${shape.name}`;
