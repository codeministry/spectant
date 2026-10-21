import { page as a } from "./features/a/page";
import { page as b } from "./features/b/page";

// Fixture for the isolation rule (spec 061, ISC-431): a root file outside the area may import every feature.
export const app = [a, b].join(" ");
