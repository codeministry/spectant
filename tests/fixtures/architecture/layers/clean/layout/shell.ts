import { clock } from "../core/clock";
import type { Format } from "../shared/kind.ts";
import { format } from "../shared/format";

// Fixture for the layers rule (spec 060, ISC-424): layout imports core and shared.
export const shell: Format = `${clock} ${format}`;
