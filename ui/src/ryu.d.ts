// The `window.ryu` bridge surface Bot Flows uses. The host installs it before
// the app module runs. `app.request` (grant `app:http`) forwards a path relative
// to the sidecar mount; `model.complete` (grant `hook:side-model`) backs the
// single-purpose "Generate flow" action; `node.shareOrigins` resolves the public
// link. The global assistant bridge is typed by `@ryu/app-host/assistant-client`.
import type {
	BotFlowsAdminRequestBody,
	BotFlowsAdminResponse,
} from "../../sidecar/src/contracts.ts";

declare global {
	interface Window {
		ryu?: {
			app?: {
				request(input: {
					body?: BotFlowsAdminRequestBody;
					method?: "GET" | "POST" | "PUT" | "DELETE";
					path: string;
				}): Promise<BotFlowsAdminResponse>;
			};
			model?: {
				complete(input: {
					effort?: string;
					prompt: string;
					system?: string;
				}): Promise<string>;
			};
			node?: {
				shareOrigins(): Promise<
					{
						origin: string;
						reachable: true;
						source: "active" | "lan" | "mesh";
					}[]
				>;
			};
		};
	}
}
