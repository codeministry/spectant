/**
 * The command of the feature-level code-review mark (spec 008, T93, ISC-122.2): `spectant gate code-reviewed F<n>
 * [--root DIR] [--yes]`. The write path itself, `codeReviewFeature` (the targets, the refusal while a claim is open, the
 * event lines, the mark), lives in the `writes/` slice (`writes/feature-gate.ts`); this command prints its plan or
 * what it wrote. Without `--yes` it prints what it would write and exits 0.
 */
import { EVENTS_PATH } from "../contracts/writes.contract.ts";
import { FEATURE_GATE_TO, codeReviewFeature, featureMarkPath } from "../writes/index.ts";

/** `spectant gate code-reviewed F<n>`: prints the plan or what was written; 0 on success and on a dry run, 1 on a refusal. */
export async function featureGateCommand(root: string, feature: string, yes: boolean): Promise<number> {
  const result = await codeReviewFeature(root, feature, { yes });
  if (!result.ok) {
    console.error(`spectant: gate code-reviewed ${feature} refused: ${result.reason}`);
    return 1;
  }
  const verb = result.written ? "wrote" : "would write";
  console.log(`gate code-reviewed ${feature} ${verb} the mark (scope ${feature}, actor ${result.actor}):`);
  for (const t of result.targets) {
    const move = t.event === null ? "already close, no event" : `${t.from} → ${FEATURE_GATE_TO} in specs/${t.folder}/${EVENTS_PATH}`;
    const tree = t.tree ?? `${t.checkout}'s, computed after the event lines`;
    const place = t.source === "worktree" ? `${t.checkout}/${featureMarkPath(t.folder)}` : featureMarkPath(t.folder);
    console.log(`  ${place} · ${move} · source ${t.source}, tree ${tree}, head ${t.head ?? "none"}`);
  }
  if (!result.written) console.log("run it again with --yes to write");
  return 0;
}
