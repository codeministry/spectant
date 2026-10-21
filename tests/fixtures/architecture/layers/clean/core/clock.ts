import { join } from "node:path";

import { tick } from "./tick.ts";

// Fixture for the layers rule (spec 060, ISC-424): core imports core and a package.
export const clock = join("now", tick);
