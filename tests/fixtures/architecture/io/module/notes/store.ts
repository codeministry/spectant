import type { Database } from "bun:sqlite";
import { readdir } from "fs/promises";

export const handle: { db?: Database } = {};

export const listNotes = (): string[] => [];

export const loadNotes = async (dir: string): Promise<string[]> => {
  const { execFileSync } = await import("node:child_process");
  return [...(await readdir(dir)), execFileSync("true").toString()];
};
