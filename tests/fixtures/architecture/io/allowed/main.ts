import { read } from "./infra/io.ts";

export const start = (path: string): Promise<string> => read(path);
