/** One canned exchange of the assistant "dot" mock (prototype `assistant.js`, design.md § Assistent), until specs 012/015. */
export interface DemoAssistantReply {
  /** The suggestion chip that asks it; also matched, case-insensitively, against a typed prompt. */
  readonly prompt: string;
  readonly reply: string;
}

export const DEMO_ASSISTANT_REPLIES: readonly DemoAssistantReply[] = Object.freeze([
  { prompt: 'What is next?', reply: 'Spec 002 is in building: T13 is takeable. Run `/spec implement 002` to continue.' },
  { prompt: 'Why is 004 stale?', reply: 'The code tree changed after the code-reviewed mark: 3 files. Review again before you close it.' },
  { prompt: 'Summarise the open claims', reply: '5 of 12 claims are open across 2 specs; none is blocked.' },
] satisfies DemoAssistantReply[]);

/** The answer to any prompt the fixture does not know. */
export const DEMO_ASSISTANT_FALLBACK = 'This is demo data: the assistant answers only its suggestions until it is connected.';
