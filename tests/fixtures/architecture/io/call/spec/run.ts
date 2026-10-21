const { write } = Bun;

export const run = (): number => Bun.spawn(["true"]).pid;

export const save = (path: string): Promise<number> => write(path, "spec");
