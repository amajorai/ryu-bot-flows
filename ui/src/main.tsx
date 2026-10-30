// Bot Flows Companion entry. Mounts the app into `#ryu-plugin-root` inside the
// shared Ryu App UI shell and follows the host's live appearance.

import {
	markCompanionAppRoot,
	subscribeCompanionTheme,
} from "@ryu/app-host/companion-theme";
import { RyuAppShell } from "@ryu/blocks/companion/app-ui";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./tailwind.css";
import { BotFlowsApp } from "./App.tsx";

subscribeCompanionTheme();
const mount = document.getElementById("ryu-plugin-root");
if (mount) {
	markCompanionAppRoot(mount);
	createRoot(mount).render(
		<StrictMode>
			<RyuAppShell className="h-full min-h-0">
				<BotFlowsApp />
			</RyuAppShell>
		</StrictMode>
	);
}
