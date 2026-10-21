import { helper } from "../b/internal.ts";
import type { Shape } from "../b/shape.ts";
import { b } from "../b/index.ts";

const shape: Shape = { size: b };

export const a = (): string => `${helper()} ${shape.size}`;
