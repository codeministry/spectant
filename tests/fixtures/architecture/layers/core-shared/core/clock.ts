import { format } from "../shared/format.ts";

// Fixture for the layers rule (spec 060, ISC-424): core imports shared.
export const clock = (): string => format("now");
