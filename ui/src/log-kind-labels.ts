/**
 * Run-log rows name the step that wrote them. The sidecar stores the step as
 * a wire token (`ai`, `http`, …); people read it as a translated label.
 */
import { translate as tl } from "@ryu/i18n/core";
import type { ResultLog } from "../../sidecar/src/contracts.ts";

/** The label a run-log row shows for the step that wrote it. */
export function logKindLabel(kind: ResultLog["kind"]): string {
	switch (kind) {
		case "ai":
			return tl("AI reply");
		case "http":
			return tl("HTTP request");
		case "redirect":
			return tl("Redirect");
		case "media":
			return tl("Media");
		case "engine":
			return tl("Engine");
		default:
			return kind satisfies never;
	}
}
