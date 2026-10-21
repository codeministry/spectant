import { a } from "../a/index.ts";

export const c = (): string => (Math.random() > 2 ? a() : "c");
