import { seedDemo } from "./seed-data";

const { DATABASE_URL: databaseUrl, PAYPAL_MODE: mode } = process.env;
if (!databaseUrl) throw new Error("DATABASE_URL is required. See docs/SETUP.md for the mock demo command.");
const inserted = await seedDemo(databaseUrl, mode);
console.log(inserted ? "Seeded 300 mock orders and 24 disputes." : "The mock demo is already seeded.");
