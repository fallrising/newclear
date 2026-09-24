import { buildSeed } from "../fixtures/seed.ts";

const s = await buildSeed();
console.log(s.id, s.sha256, JSON.stringify(s.description.counts));
