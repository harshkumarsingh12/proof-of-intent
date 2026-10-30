import { JOBS } from "./pipeline";

// Simplification: placeholder loop so the container stays healthy; replace with pg-boss workers (spec 0005).
console.log(`worker up; jobs to implement: ${Object.values(JOBS).join(", ")}`);
setInterval(() => {}, 1 << 30);
