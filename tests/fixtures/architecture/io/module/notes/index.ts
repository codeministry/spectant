import { readFileSync } from "node:fs";

import { listNotes } from "./store.ts";

export const notes = (path: string): string[] => [readFileSync(path, "utf8"), ...listNotes()];
