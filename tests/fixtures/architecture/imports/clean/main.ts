import { db } from "./infra/db.ts";
import { notes } from "./notes/index.ts";
import { sql } from "./notes/store/sql.ts";

export const main = (): string => `${db.id} ${notes()} ${sql}`;
