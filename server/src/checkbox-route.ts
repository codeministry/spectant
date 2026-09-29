/**
 * The checkbox route (T70, ISC-25): `POST …/:id/tasks/:tid/check`. The task is found by `core/`'s `parseTaskLines`
 * (fenced and struck lines are no task: 404), tasks.md's raw sha256 is compared with the one the Tasks tab was rendered
 * with (409 on a mismatch), and the one byte inside that line's `[ ]` / `[x]` is set. Every other byte stays: the line
 * endings (LF, CRLF or CR), a byte order mark, every other line. A tick to the state the box already holds is a 200
 * with the unchanged line and no write, so a retry after a lost answer never flips it back.
 */
import { specFilePath } from "../../core/src/files.ts";
import type { SpecRef } from "../../core/src/resolve.ts";
import { BOX_LINE, parseTaskLines } from "../../core/src/tasks.ts";
import type { TaskCheckRequest } from "./spec-routes.contract.ts";
import { readBytesIfExists, readSpecFiles } from "./workspace-loader.ts";
import { tasksConflict } from "./writes.contract.ts";
import { type WriteResult, rawSha256, runWrite, writeInPlace } from "./writes.ts";

export interface CheckboxWriteInput {
  readonly root: string;
  readonly ref: Pick<SpecRef, "dir" | "slug">;
  readonly stateDir: string | null;
  readonly now: Date;
  readonly tid: string;
  readonly body: TaskCheckRequest;
  /** The workspace's constitution: the lane table the parser reads, and the spec's claims for the lock check. */
  readonly constitution: string | null;
}

const LF = 0x0a;
const CR = 0x0d;
const OPEN_BRACKET = 0x5b;
const CHECKED = 0x78; // x
const UNCHECKED = 0x20; // space

/** Byte offsets of line `line` (1-based), its ending excluded; lines split as the parser splits them (LF, CRLF, CR). */
function lineRange(bytes: Uint8Array, line: number): { start: number; end: number } | null {
  let start = 0;
  for (let n = 1; ; n++) {
    let end = start;
    while (end < bytes.length && bytes[end] !== LF && bytes[end] !== CR) end++;
    if (n === line) return { start, end };
    if (end >= bytes.length) return null;
    start = bytes[end] === CR && bytes[end + 1] === LF ? end + 2 : end + 1;
  }
}

const lineText = (bytes: Buffer, range: { start: number; end: number }): string =>
  bytes.subarray(range.start, range.end).toString("utf8").replace(/^\uFEFF/, "");

export function writeTaskCheck(input: CheckboxWriteInput): Promise<WriteResult<"taskCheck">> {
  const { ref, tid, body } = input;
  const path = specFilePath(ref.dir, "tasks");
  return runWrite<"taskCheck">({
    root: input.root,
    stateDir: input.stateDir,
    now: input.now,
    read: () => {
      const bytes = readBytesIfExists(path);
      if (bytes === null) return null;
      const text = bytes.toString("utf8");
      const constitution = input.constitution === null ? {} : { constitution: input.constitution };
      const row = parseTaskLines({ tasks: text, ...constitution }).tasks.find((t) => t.id === tid && t.state !== "struck");
      if (row === undefined) return null;
      const hash = rawSha256(bytes);
      const stale = tasksConflict(body.hash, hash);
      if (stale !== null) return { stale };

      // The flip works on the raw bytes: line endings are ASCII, and so is everything before the box on a box line
      // (`\s*- [`, a byte order mark aside), so the line's first `[` is the box and no other byte is re-encoded.
      const range = lineRange(bytes, row.line);
      const current = range === null ? "" : lineText(bytes, range);
      const box = BOX_LINE.exec(current);
      // The parser found this task on this line; anything else is a defect, never a write to some other line.
      if (range === null || box?.[2] !== tid) throw new Error(`tasks.md line ${String(row.line)} is not the box line of ${tid}`);
      const at = bytes.indexOf(OPEN_BRACKET, range.start) + 1;
      const files = readSpecFiles(ref);
      return {
        files: { folder: files.folder, texts: { ...files.texts, tasks: text, ...constitution } },
        claim: row.claim,
        commit: (lockSource) => {
          const done = box[1] !== " ";
          if (done === body.checked) return { task: tid, checked: done, hash, lockSource, line: { number: row.line, text: current } };
          const next = Buffer.from(bytes);
          next[at] = body.checked ? CHECKED : UNCHECKED;
          writeInPlace(path, next);
          return { task: tid, checked: body.checked, hash: rawSha256(next), lockSource, line: { number: row.line, text: lineText(next, range) } };
        },
      };
    },
  });
}
