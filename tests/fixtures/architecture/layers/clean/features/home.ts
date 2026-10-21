import { clock } from "../core/clock";
import { shell } from "../layout/shell";
import { format } from "../shared/format";

// Fixture for the layers rule (spec 060, ISC-424): features imports every layer before it.
export const home = [clock, format, shell].join(" ");
