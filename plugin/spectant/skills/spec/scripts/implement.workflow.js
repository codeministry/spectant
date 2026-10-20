export const meta = {
  name: 'spec-implement-round',
  description: 'One /spec implement round: build each dispatched task in its own worktree, optionally second-look each patch, return results and questions',
  whenToUse: 'When the user has opted into a workflow for `/spec implement NNN` and the parent has saved the round plan (passed as args)',
  phases: [
    { title: 'Build', detail: 'one builder per dispatched task, worktree-isolated' },
    { title: 'Second look', detail: 'opt-in (secondLook: true): a fresh read-only reviewer per patch' },
  ],
}

// args = {
//   plan:  { dispatch: [{ id, claim, lane?, text, path?, after? }], held?: [...], exhausted?: boolean }
//          (the round plan the parent built from `spec-check frontier <spec> --json`, workflows/implement.md Step 3),
//   brief: { spec,               absolute path of specs/NNN-slug/spec.md in the parent's checkout; its folder's NNN
//                                is the spec number of the marker line
//            goal,               the spec's goal, byte for byte
//            cli?,               'bun "<absolute path>/bin/spec-check"', resolved by the parent; default below
//            actor?,             the parent actor 'a:<kind>:<id>'; builders log as '<actor>/T<k>'
//            lanes?: { <lane>: <profile text> }, seams?: { <task id>: <contract> },
//            packs?: { <task id>: <the one JSON line of `spec-check pack <spec> <task id> --json`> } },
//   builder?: agent type of the builders, reader?: agent type of the optional reviewer, secondLook?: false,
//   ts: '<ISO-8601 from the parent>' }
// The script has no filesystem: everything a builder needs is in the brief. A task with a pack (spec 010, T21,
// ISC-340) gets it on a `PACK:` line in place of the SPEC, GOAL and CLAIM lines, and the spec path only as a fallback;
// a task without one reads the spec itself from the path the brief names. It writes no bookkeeping: every builder's prompt opens with the marker line
// `spectant: spec=<NNN> task=<Tn> claim=<ISC-N>`, from which the plugin's hooks write the claim, dispatch, build and
// release lines; the parent writes the run pair and the patch/apply lines, applies the patches, runs the write order
// and records the round. Start it from the spec's own checkout: worktree isolation branches from the session's HEAD.

const RESULT_SCHEMA = {
  type: 'object',
  required: ['kind', 'task', 'claim', 'lane'],
  properties: {
    kind: { type: 'string', enum: ['result', 'question'] },
    task: { type: 'string' }, claim: { type: 'string' }, lane: { type: 'string' },
    // result
    probe_command: { type: 'string' }, exit_code: { type: 'number' }, stub: { type: 'string' },
    red_before: { type: 'boolean' },
    files_touched: { type: 'array', items: { type: 'string' } },
    worktree: { type: 'string' },
    marks: { type: 'array', items: { type: 'string' } },
    // question
    question: { type: 'string' },
    options: { type: 'array', items: { type: 'string' } },
    recommended: { type: 'string' }, why: { type: 'string' },
    seam_change: { type: 'boolean' },
    state: { type: 'array', items: { type: 'string' } },
  },
}

const VERDICT_SCHEMA = {
  type: 'object',
  required: ['verdict', 'findings'],
  properties: {
    verdict: { type: 'string', enum: ['pass', 'concerns', 'fail'] },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['severity', 'issue'],
        properties: {
          severity: { type: 'string', enum: ['critical', 'warning', 'info'] },
          isc_ref: { type: 'string' }, issue: { type: 'string' }, evidence: { type: 'string' },
        },
      },
    },
  },
}

const { plan, brief, builder, reader, secondLook = false } = args || {}
if (!plan || !Array.isArray(plan.dispatch)) throw new Error('args.plan needs a dispatch array (the round plan)')
if (!brief || !brief.spec || !brief.goal) throw new Error('args.brief needs spec and goal')

// The plugin CLI; the parent should pass the resolved absolute path, since a builder may not see the plugin variable.
const cli = brief.cli || 'bun "${CLAUDE_PLUGIN_ROOT}/bin/spec-check"'
const actor = brief.actor || 'a:claude:spec'

// The marker line, the same format as markerLine in the plugin's src/marker.ts (the Workflow sandbox cannot import it;
// plugin/tests/implement-workflow.test.ts pins the two against each other). A field the hooks' parser would reject
// fails the round before any builder starts, rather than dispatch a brief the hooks cannot see.
const specNumber = (/(?:^|\/)(\d{3})-[^/]+\/spec\.md$/.exec(brief.spec) || [])[1]
if (!specNumber) throw new Error('args.brief.spec must be the path of specs/NNN-slug/spec.md (its NNN goes into the marker line)')
const markerLine = (t) => {
  if (!/^T\d+$/.test(t.id)) throw new Error(`task id must be T<n>, got "${t.id}"`)
  if (!/^ISC-\d+(?:\.\d+)*$/.test(t.claim)) throw new Error(`claim must be ISC-<n>[.<n>], got "${t.claim}"`)
  return `spectant: spec=${specNumber} task=${t.id} claim=${t.claim}`
}
for (const t of plan.dispatch) markerLine(t)

// The pack of a task, as one line: the CLI's output with its line break dropped. A pack that is no single JSON line,
// or that names another task or claim, fails the round before any builder starts, like a garbled marker field.
const packOf = (t) => {
  const raw = brief.packs && brief.packs[t.id]
  if (raw === undefined || raw === null) return null
  const line = typeof raw === 'string' ? raw.trim() : JSON.stringify(raw)
  let pack = null
  try {
    pack = line.includes('\n') ? null : JSON.parse(line)
  } catch {
    pack = null
  }
  if (!pack || typeof pack !== 'object') throw new Error(`the pack of ${t.id} must be the one JSON line of spec-check pack`)
  const task = pack.task && pack.task.id
  const claim = pack.claim && pack.claim.id
  if (task !== t.id || claim !== t.claim) throw new Error(`the pack of ${t.id} names ${task} ${claim}, not ${t.id} ${t.claim}`)
  return line
}
for (const t of plan.dispatch) packOf(t)

if (plan.dispatch.length === 0) {
  log(plan.exhausted ? 'frontier exhausted: nothing to dispatch' : 'nothing dispatchable this round')
  return { dispatched: 0, results: [], questions: [], failed: [], verdicts: [] }
}
log(`round: ${plan.dispatch.length} task(s) → ${plan.dispatch.map((t) => t.id).join(', ')}`)

// The step events: the builder logs every run of its probe and every question itself, from inside its worktree;
// the CLI resolves the repository root, so the line lands in the root's .spectant/activity.jsonl.
const stepLines = (t) => {
  const who = `${actor}/${t.id}`
  return [
    `STEPS:     after EVERY run of your probe, before anything else:`,
    `             ${cli} activity probe --result <red if exit≠0, else green> --task ${t.id} --claim ${t.claim} --session ${who}`,
    `           before you return kind=question:`,
    `             ${cli} activity question --text "<the question, one line>" --task ${t.id} --claim ${t.claim} --session ${who}`,
  ]
}

const seamOf = (t) => {
  if (!brief.seams) return ''
  if (brief.seams[t.id]) return brief.seams[t.id]
  return (t.after || []).map((a) => brief.seams[a]).filter(Boolean).join('\n')
}

// With a pack, the builder has the goal, its task, claim, probe row, lane and decisions in hand and reads the spec only
// to answer what the pack cannot; without one, the classic lines send it to the spec.
const specLines = (t) => {
  const pack = packOf(t)
  if (pack) {
    return [
      `PACK:      ${pack}`,
      `SPEC:      ${brief.spec}   (fallback only: read it to answer a question the pack cannot; the pack's probe is your PROBE)`,
    ]
  }
  return [
    `SPEC:      ${brief.spec}   (read it first; you are closing one claim of it)`,
    `GOAL:      "${brief.goal}"`,
    `CLAIM:     ${t.claim} — read its text and its Test Strategy row in the spec verbatim; that row is your PROBE`,
  ]
}

const buildPrompt = (t) => [
  markerLine(t),
  ...specLines(t),
  `TASK:      ${t.id} · ${t.lane || 'no lane'} — ${t.text}${t.path ? ' · ' + t.path : ''}`,
  `LANE:      ${t.lane || 'none'}\n${(brief.lanes && t.lane && brief.lanes[t.lane]) || '(no lane profile: load the nearest CLAUDE.md above your path)'}`,
  `SEAM:      ${seamOf(t) || 'none'}`,
  ...stepLines(t),
  `ISOLATION: you run in your own git worktree. Never commit, never switch branches, never touch files outside`,
  `           your path column unless the probe forces it, then list them in files_touched. Report the worktree path.`,
  `RETURN:    kind=result when the probe named above ran red before your change and green after (say so in red_before).`,
  `           kind=question ONLY when a wrong choice would change the claim set, the seam, or make the probe`,
  `           unmeetable: give 2-3 options, mark one recommended, say why, set seam_change when it changes a seam,`,
  `           and list the files you already touched in state. Anything you decided without asking goes into marks`,
  `           as "⟨?: what — why unsure⟩". Never ask what the repository can answer. No commits.`,
].join('\n')

const lookPrompt = (t, r) => [
  `SECOND LOOK — read-only. You did not build this; try to refute it.`,
  `SPEC:  ${brief.spec}`, `GOAL:  "${brief.goal}"`, `CLAIM: ${t.claim}`, `TASK:  ${t.id} — ${t.text}`,
  `WORKTREE: ${r.worktree || '(not reported: inspect the diff the parent names)'}   run: git -C <worktree> status and diff`,
  `PROBE: ${r.probe_command} → exit ${r.exit_code}; builder says red_before=${r.red_before}`,
  `MARKS: ${(r.marks || []).join(' | ') || 'none'}`,
  `Answer with evidence: does the diff close ${t.claim} as written, or only something that resembles it?`,
  `Did the probe run at the boundary the Test Strategy row names? Is any mark actually a seam change?`,
  `Do not edit anything. Verdict pass only when no finding is critical.`,
].join('\n')

const outcomes = await pipeline(
  plan.dispatch,
  (t) => agent(buildPrompt(t), {
    label: `build:${t.id}`, phase: 'Build', schema: RESULT_SCHEMA,
    isolation: 'worktree', ...(builder ? { agentType: builder } : {}),
  }).then((r) => r && ({ ...r, task: r.task || t.id, claim: r.claim || t.claim, lane: r.lane || t.lane || '', builder: builder || 'default' })),
  (r, t) => {
    if (!r) return { task: t.id, claim: t.claim, kind: 'failed', reason: 'builder returned nothing', builder: builder || 'default' }
    if (r.kind === 'question') return r
    if (!secondLook || r.exit_code !== 0) return { ...r, verdict: null }
    return agent(lookPrompt(t, r), {
      label: `look:${t.id}`, phase: 'Second look', schema: VERDICT_SCHEMA, ...(reader ? { agentType: reader } : {}),
    }).then((v) => ({ ...r, reader: reader || 'default', verdict: v || { verdict: 'skipped', findings: [], reason: 'reviewer returned nothing' } }))
  },
)

const all = outcomes.filter(Boolean)
const questions = all.filter((o) => o.kind === 'question')
const results = all.filter((o) => o.kind === 'result')
const failed = all.filter((o) => o.kind === 'failed')
log(`round done: ${results.length} result(s), ${questions.length} question(s), ${failed.length} failed`)
return {
  dispatched: plan.dispatch.length,
  results,
  questions,
  failed,
  verdicts: results.map((r) => ({ task: r.task, verdict: r.verdict && r.verdict.verdict })),
}
