import { defineConfig } from "@playwright/test";
import { E2E_TOKEN, SIDECAR_PORT, UI_PORT } from "./bot-flows-test-host.ts";

// Local harness for the Bot Flows Companion: the real sidecar on an isolated
// data directory plus the Vite dev server, with a test bridge standing in for
// the Ryu host (see bot-flows-test-host.ts). This is harness-only evidence, not
// a round-trip through Core's ext-proxy.
const dataDirectory =
	process.env.RYU_BOT_FLOWS_TEST_DATA_DIR ?? "/tmp/ryu-bot-flows-e2e";

export default defineConfig({
	testDir: ".",
	// A string literal naming the spec, so `apps-store/companion-suite.mjs`
	// (`configSelectingSpec`) can map e2e/bot-flows-workflow.spec.ts to this config.
	testMatch: "bot-flows-workflow.spec.ts",
	workers: 1,
	timeout: 120_000,
	expect: { timeout: 15_000 },
	reporter: "list",
	outputDir: "/tmp/ryu-bot-flows-playwright-results",
	use: {
		headless: true,
		viewport: { width: 1440, height: 900 },
		launchOptions: process.env.RYU_PLAYWRIGHT_CHROMIUM
			? { executablePath: process.env.RYU_PLAYWRIGHT_CHROMIUM }
			: {},
	},
	webServer: [
		{
			command: `rm -rf ${dataDirectory} && RYU_PROFILE=dev RYU_KEYCHAIN=off RYU_DIR=${dataDirectory} RYU_EXT_TOKEN=${E2E_TOKEN} RYU_BOT_FLOWS_PORT=${SIDECAR_PORT} bun run ../../sidecar/src/index.ts`,
			url: `http://127.0.0.1:${SIDECAR_PORT}/health`,
			reuseExistingServer: false,
			timeout: 30_000,
		},
		{
			command: `RYU_BOT_FLOWS_PORT=${SIDECAR_PORT} bunx vite --config ../vite.config.ts`,
			url: `http://127.0.0.1:${UI_PORT}/`,
			reuseExistingServer: false,
			timeout: 60_000,
		},
	],
});
