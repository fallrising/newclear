// Example: node sdk/js/example.mjs
import { Client } from "./clarkq.js";

const client = new Client(
  process.env.CLARKQ_URL || "http://localhost:8080",
  process.env.CLARKQ_API_KEY || ""
);

await client.health();
const res = await client.enqueue("sdk-demo", "hello from js sdk", { lang: "js" });
console.log("enqueued", res);
const msg = await client.dequeue("sdk-demo", { timeout: 2 });
console.log("dequeued", msg);
