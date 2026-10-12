// The story files `specs/ideas/*.md` (spec 008, ISC-124, ISC-125): each story with frontmatter as an `IdeaRef` of the
// stage `idea`, and `README.md` as the index checked against the files. Seam T37 holds the signature; T51 reads the
// stories, T52 checks the index. Browser-safe: no file system, the caller passes the folder's texts in.
import type { IdeaFiles, IdeasReading } from './files.ts';

/** Reads the story folder: file name to text, `README.md` the index; an empty record is a repository without stories. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- stub (spec 008, T51): the folder is read once the reader lands
export function readIdeas(files: IdeaFiles): IdeasReading {
  // stub (spec 008, T51): no stories read yet.
  return { ideas: [], diagnostics: [] };
}
