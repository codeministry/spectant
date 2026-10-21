import { Database } from "bun:sqlite";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";

export const open = (path: string): Database => new Database(path);

export const readBoth = async (path: string): Promise<string> =>
  readFileSync(path, "utf8") + (await readFile(path, "utf8"));

export const read = (path: string): Promise<string> => Bun.file(path).text();

export const save = (path: string, text: string): Promise<number> => Bun.write(path, text);

export const run = (): number => Bun.spawn(["true"]).pid + (spawnSync("true").status ?? 0);
