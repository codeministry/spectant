// The evidence listing (T24, ISC-83): `artifacts/` and `.evidence/` grouped by claim with media type, confined
// to the spec folder. Reads only. T24 may make the function `async`.
// Stub from the T1 seam: the fill-in task replaces the body and keeps the exported name and types.
import type { EvidenceFile } from './files.ts';

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- stub parameters; the fill-in uses them and drops this line
export function listEvidence(_specDir: string): Promise<EvidenceFile[]> {
  throw new Error('not implemented: listEvidence');
}
