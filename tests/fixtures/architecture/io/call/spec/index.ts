import { run } from "./run.ts";

export const readSpec = (path: string): Promise<string> => Bun.file(path).text();

export const runSpec = (): number => run();
