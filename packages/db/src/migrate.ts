// pnpm --filter @poi/db migrate: applies pending migrations, then exits. Compose runs it before the api and worker.
import { createDb } from "./index";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}
const db = createDb(url);
try {
  const applied = await db.migrate();
  console.log(applied.length ? `applied ${applied.join(", ")}` : "schema up to date");
} finally {
  await db.close();
}
