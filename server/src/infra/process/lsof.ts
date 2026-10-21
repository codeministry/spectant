/**
 * The `lsof` spawn behind the dev-services indicator (`services.ts`, T48, ISC-16): runs `lsof` with the given
 * arguments and captures its stdout and exit code. Null when `lsof` is not on PATH; `services.ts` turns that, a
 * failed spawn or a non-zero exit into `[]`, never a throw.
 */

/** Runs `lsof` with these arguments. Null when `lsof` is not on PATH. */
export type LsofRun = (args: string[]) => Promise<{ code: number; stdout: string } | null>;

export const defaultLsof: LsofRun = async (args) => {
  const lsof = Bun.which("lsof", { PATH: process.env.PATH ?? "" });
  if (!lsof) return null;
  const child = Bun.spawn([lsof, ...args], { stdout: "pipe", stderr: "ignore", stdin: "ignore" });
  const [stdout, code] = await Promise.all([new Response(child.stdout).text(), child.exited]);
  return { code, stdout };
};
