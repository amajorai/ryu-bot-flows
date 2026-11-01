import { join } from "node:path";
import {
	resolvePluginDataDir,
	resolveSidecarPort,
	resolveSidecarToken,
} from "@ryu/sidecar-runtime";
import { createBotHost, PLUGIN_ID } from "./host.ts";
import { createBotFlowsServer } from "./server.ts";
import { BotFlowsStore } from "./store.ts";

const PURGE_INTERVAL_MS = 10 * 60 * 1000;

const token = resolveSidecarToken(Bun.env);
if (!token) {
	throw new Error("Bot Flows requires its Core-minted extension token");
}
const dataDirectory = resolvePluginDataDir(Bun.env, PLUGIN_ID);
const store = new BotFlowsStore(join(dataDirectory, "bot-flows.sqlite"));
store.purgeExpired();
const server = createBotFlowsServer({
	store,
	token,
	host: createBotHost(Bun.env, token),
	port: resolveSidecarPort(Bun.env, "RYU_BOT_FLOWS_PORT", 8028),
});
const purgeTimer = setInterval(() => store.purgeExpired(), PURGE_INTERVAL_MS);
console.info(`[ryu-bot-flows] service listening on ${server.port}`);

function stop(): void {
	clearInterval(purgeTimer);
	server.stop();
	store.close();
}

process.once("SIGINT", stop);
process.once("SIGTERM", stop);
