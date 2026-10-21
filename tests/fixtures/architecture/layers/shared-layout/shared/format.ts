import { clock } from "../core/clock.ts";
import type { Shell } from "../layout/shell.ts";

// Fixture for the layers rule (spec 060, ISC-424): shared imports layout, type-only.
export const format = (shell: Shell): string => `${clock} ${shell.title}`;
