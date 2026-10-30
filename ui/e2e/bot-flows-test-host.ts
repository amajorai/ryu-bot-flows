import type { Page } from "@playwright/test";

export const SIDECAR_PORT = 19_027;
export const UI_PORT = 19_028;
export const E2E_TOKEN = "bot-flows-e2e-token";
export const UI_ORIGIN = `http://127.0.0.1:${UI_PORT}`;
export const SIDECAR_ORIGIN = `http://127.0.0.1:${SIDECAR_PORT}`;

/**
 * Installs a stand-in for the Ryu host bridge. `app.request` forwards to the
 * locally started sidecar through the Vite proxy with the extension token, the
 * way Core's ext-proxy would, and rejects a failed response with only
 * `"<proxy path> failed: <status>"` as the real bridge does; `model.complete` returns a canned reply; and
 * `node.shareOrigins` reports the harness origin so share links resolve.
 */
export async function installBotFlowsHost(
	page: Page,
	options: { modelReply?: string; token: string }
): Promise<void> {
	await page.addInitScript(({ modelReply, token }) => {
		const calls: { method: string; path: string; status?: number }[] = [];
		Object.defineProperty(window, "__ryuBotFlowsCalls", {
			configurable: true,
			value: calls,
		});
		const request = async (input: {
			body?: unknown;
			method?: string;
			path: string;
		}) => {
			const call: { method: string; path: string; status?: number } = {
				method: input.method ?? "GET",
				path: input.path,
			};
			calls.push(call);
			const headers = new Headers({ authorization: `Bearer ${token}` });
			const init: RequestInit = { method: call.method, headers };
			if (input.body !== undefined) {
				headers.set("content-type", "application/json");
				init.body = JSON.stringify(input.body);
			}
			const response = await fetch(`/api/bot-flows${input.path}`, init);
			call.status = response.status;
			if (!response.ok) {
				// The real bridge drops the error body: Desktop's ApiError goes
				// through toRpcError and the frame sees only this message.
				throw new Error(
					`/api/ext/@ryu/bot-flows${input.path} failed: ${response.status}`
				);
			}
			return response.json();
		};
		const bridge: Record<string, unknown> = {
			app: { request },
			node: {
				shareOrigins: async () => [
					{ origin: location.origin, reachable: true, source: "active" },
				],
			},
		};
		if (modelReply !== undefined) {
			bridge.model = { complete: async () => modelReply };
		}
		Object.defineProperty(window, "ryu", { configurable: true, value: bridge });
	}, options);
}
