// The person id of the actor grammar (spec 008, T59, ISC-119): `u:` plus the first eight hex digits of sha256 over
// the lower-cased, trimmed git `user.email`. Unsalted by default, so two machines with the same address agree on one
// person without any exchange; a salt, when given, is prepended to the normalised address before hashing. Reading
// `user.email` from the repository's git configuration is the caller's job (server, T77); this module takes the text.
//
// Hashing uses `createHash` from `node:crypto`, which makes this a server-side module like `gates.ts`: the barrel
// (`index.ts`) does not re-export it, so the browser bundle never pulls `node:crypto` in.
import { createHash } from 'node:crypto';

/** The `u:` actor id of an e-mail address: `u:` + sha256(salt + lower-cased trimmed address), first eight hex digits. */
export function actorIdOf(email: string, salt = ''): string {
  const normalised = email.trim().toLowerCase();
  return `u:${createHash('sha256').update(salt + normalised, 'utf8').digest('hex').slice(0, 8)}`;
}
