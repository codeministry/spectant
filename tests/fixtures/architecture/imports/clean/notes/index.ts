import { join } from "node:path";

import type { Row } from "../contracts/row.contract.ts";
import { db } from "../infra/db.ts";
import { spec } from "../spec/index.ts";
import { sql } from "./store/sql.ts";

const row: Row = db;

export const notes = (): string => join(row.id, spec(), sql);
