// The reason keys of the guidance (spec 020, ISC-237.1): one `stage.<stage>.<i>` per template of each open spec row of
// the stage table, then the three `waiting.*` keys with their fixed English templates. Kept apart from guidance.ts,
// whose parsers reach Node APIs, so the web's catalogue test imports the one list instead of deriving it again.
//
// Browser-safe: it imports the stage table and a type, nothing else.
import type { WaitingItem } from './files.ts';
import { SPEC_RULES } from './stage.ts';

/** One reason a guidance entry can carry: its key, the English template and the template's placeholders. */
export interface GuidanceReasonTemplate {
  readonly key: string;
  readonly template: string;
  readonly placeholders: readonly string[];
}

/** The fixed English templates of the three waiting kinds. */
export const WAITING_TEMPLATES: Readonly<Record<WaitingItem['kind'], string>> = {
  manual: '{ref} needs your confirmation',
  operator: '{ref} is your step',
  question: 'the newest round asks about {ref}',
};

const placeholdersOf = (template: string): string[] => [...new Set([...template.matchAll(/\{([a-zA-Z]+)\}/g)].map((m) => m[1] as string))];

const OPEN_RULES = SPEC_RULES.filter((rule) => rule.state === 'open');

/**
 * Where a row's keys start within its stage: after the templates of the stage's later rows, so a row put in front of
 * an existing one (spec 043: the claimless row 3 before `plan.md`'s row 4) adds keys and renames none.
 */
const offsetOf = (index: number): number =>
  OPEN_RULES.slice(index + 1)
    .filter((rule) => rule.stage === OPEN_RULES[index]?.stage)
    .reduce((n, rule) => n + rule.reasons.length, 0);

/**
 * Every reason key, generated: one `stage.<stage>.<i>` per template of each open spec row of the stage table, then the
 * three `waiting.*` keys. Never hand-maintained; a new stage template is a new key here.
 */
export const GUIDANCE_REASONS: readonly GuidanceReasonTemplate[] = [
  ...OPEN_RULES.flatMap((rule, index) =>
    rule.reasons.map((template, i) => ({ key: `stage.${rule.stage}.${offsetOf(index) + i}`, template, placeholders: placeholdersOf(template) })),
  ),
  ...(Object.entries(WAITING_TEMPLATES) as Array<[WaitingItem['kind'], string]>).map(([kind, template]) => ({
    key: `waiting.${kind}`,
    template,
    placeholders: placeholdersOf(template),
  })),
];

export const GUIDANCE_REASON_KEYS: readonly string[] = GUIDANCE_REASONS.map((r) => r.key);
