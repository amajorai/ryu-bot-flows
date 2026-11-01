import { describe, expect, test } from "bun:test";
import { ASSISTANT_LIMITS } from "@ryu/app-host/assistant-client";
import { formatMessage } from "@ryu/i18n";
import type { LiteralMessage } from "@ryu/i18n/react";
import { listTemplates } from "../../sidecar/src/templates.ts";
import { buildBotContext, buildBotSurface, flowOutline } from "./assistant.ts";

const tl: LiteralMessage = (source, values) => formatMessage(source, values);

const templates = listTemplates();

describe("assistant context", () => {
	test("outlines groups, blocks, routes and variables", () => {
		const support = templates.find(
			(template) => template.id === "support-triage"
		);
		if (!support) {
			throw new Error("missing template");
		}
		const outline = flowOutline(support.flow);
		expect(outline).toContain("(start)");
		expect(outline).toContain("→");
		expect(outline).toMatch(/Variables: .+/);
	});

	test("every template fits the host's context caps", () => {
		for (const template of templates) {
			const items = buildBotContext(
				{
					id: `bot_${template.id}`,
					name: template.name,
					slug: template.id,
					status: "draft",
				},
				template.flow
			);
			expect(items.length).toBeGreaterThan(0);
			expect(items.length).toBeLessThanOrEqual(4);
			for (const item of items) {
				expect(item.text.length).toBeLessThanOrEqual(
					ASSISTANT_LIMITS.contextText
				);
				expect(item.id.startsWith(`bot:bot_${template.id}`)).toBe(true);
			}
		}
	});

	test("the surface scopes one thread per bot", () => {
		const surface = buildBotSurface({ id: "bot_1", name: "Support" }, tl);
		expect(surface.thread).toBe("bot:bot_1");
		expect(surface.prompts?.length).toBeGreaterThan(0);
		expect(surface.preamble).toContain("untrusted");
	});
});
