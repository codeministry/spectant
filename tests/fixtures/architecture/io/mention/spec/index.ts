// The infra layer calls Bun.write(path, text); this slice only formats.
/* Bun.spawn and Bun.file live in infra/, as does `import { readFileSync } from "node:fs"`. */

/** Shapes the text that infra passes to Bun.write. */
export const label = (name: string): string => `Bun.file(${name.trim()}) and 'Bun.write'`;

export const call = "Bun.spawn(['true'])";

export const pattern = /Bun\.file\(/;

export const note = "node:fs";

export const MyBun = { file: (name: string): string => name };

export const named = MyBun.file("spec");
