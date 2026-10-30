import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const outfile = resolve(root, "dist/ryu-bot-flows");
mkdirSync(dirname(outfile), { recursive: true });
const result = await Bun.build({
	compile: { outfile },
	entrypoints: [resolve(root, "src/index.ts")],
	target: "bun",
});
if (!result.success) {
	throw new AggregateError(result.logs, "Bot Flows sidecar build failed");
}
