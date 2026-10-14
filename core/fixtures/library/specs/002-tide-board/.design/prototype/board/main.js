// A module script: the sandboxed page fetches it, and what it imports, in CORS mode with `Origin: null`.
import { TIDE } from "./tide.mjs";

document.documentElement.dataset.tide = TIDE;
