import { clock } from "../core/clock";
import { home } from "../features/home";

// Fixture for the layers rule (spec 060, ISC-424): layout imports features.
export const shell = `${clock} ${home}`;
