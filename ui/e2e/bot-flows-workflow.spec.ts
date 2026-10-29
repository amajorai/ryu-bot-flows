import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { type APIRequestContext, expect, test } from "@playwright/test";
import { z } from "zod";
import {
	botDocumentSchema,
	botListItemSchema,
	type PublicTurn,
	publicTurnSchema,
	type ReplyValue,
} from "../../sidecar/src/contracts.ts";
import { listTemplates } from "../../sidecar/src/templates.ts";
import {
	E2E_TOKEN,
	installBotFlowsHost,
	SIDECAR_ORIGIN,
	UI_ORIGIN,
} from "./bot-flows-test-host.ts";

const evidence = resolve(import.meta.dirname, "evidence");
const admin = { authorization: `Bearer ${E2E_TOKEN}` };

test.beforeAll(async () => {
	await mkdir(evidence, { recursive: true });
});

test.beforeEach(async ({ request }) => {
	const response = await request.get(
		`${SIDECAR_ORIGIN}/api/bot-flows/admin/bots`,
		{
			headers: admin,
		}
	);
	expect(response.ok(), "the isolated Bot Flows sidecar is ready").toBe(true);
	for (const bot of z.array(botListItemSchema).parse(await response.json())) {
		const deleted = await request.delete(
			`${SIDECAR_ORIGIN}/api/bot-flows/admin/bots/${bot.id}`,
			{ headers: admin }
		);
		expect(deleted.ok()).toBe(true);
	}
});

/** Answers whatever the bot asks with a plausible value. */
function answerFor(turn: PublicTurn, pick: number): ReplyValue | null {
	const input = turn.input;
	if (!input) {
		return null;
	}
	switch (input.type) {
		case "choice_input": {
			const item = input.items[pick % input.items.length] ?? input.items[0];
			return input.multiple ? [item?.id ?? ""] : (item?.id ?? "");
		}
		case "rating_input":
			return input.scale === "nps" ? "9" : "4";
		case "email_input":
			return "ada@example.com";
		case "phone_input":
			return "+1 555 0100";
		case "url_input":
			return "https://example.com";
		case "number_input":
			return "3";
		case "date_input":
			return input.withTime ? "2026-11-02T10:00" : "2026-11-02";
		default:
			return "It stopped syncing after the update.";
	}
}

/** Runs one public conversation through the sidecar, stopping after `steps`. */
async function converse(
	request: APIRequestContext,
	slug: string,
	pick: number,
	steps: number
): Promise<void> {
	const started = await request.post(
		`${SIDECAR_ORIGIN}/api/bot-flows/${slug}/sessions`,
		{
			data: {},
		}
	);
	expect(started.status()).toBe(201);
	let turn = publicTurnSchema.parse(await started.json());
	for (let step = 0; step < steps && !turn.done; step++) {
		const value = answerFor(turn, pick);
		if (value === null) {
			break;
		}
		const replied = await request.post(
			`${SIDECAR_ORIGIN}/api/bot-flows/${slug}/sessions/${turn.sessionId}/reply`,
			{ data: { value } }
		);
		expect(replied.ok()).toBe(true);
		turn = publicTurnSchema.parse(await replied.json());
	}
}

test("builds, previews, publishes, shares, and reviews results for a bot", async ({
	page,
	request,
	browser,
}) => {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));
	const leadCapture = listTemplates().find(
		(template) => template.id === "lead-capture"
	);
	if (!leadCapture) {
		throw new Error("lead-capture template missing");
	}
	await installBotFlowsHost(page, {
		token: E2E_TOKEN,
		modelReply: `Here is the flow:\n\`\`\`json\n${JSON.stringify({
			variables: leadCapture.flow.variables,
			groups: leadCapture.flow.groups,
			edges: leadCapture.flow.edges,
			startGroupId: leadCapture.flow.startGroupId,
		})}\n\`\`\``,
	});

	await page.goto(`${UI_ORIGIN}/`);
	await expect(
		page.getByRole("heading", { name: "No bots yet" })
	).toBeVisible();

	// Template gallery.
	await page.getByRole("button", { name: "New bot" }).click();
	const dialog = page.getByRole("dialog");
	await expect(
		dialog.getByTestId("template-gallery").getByRole("button")
	).toHaveCount(10);
	await dialog.getByRole("button", { name: /Support triage/ }).click();
	await expect(dialog.getByLabel("Bot name")).toHaveValue("Support triage");
	await dialog.screenshot({
		path: resolve(evidence, "bot-flows-template-gallery.png"),
	});
	await dialog.getByRole("button", { name: "Create bot" }).click();
	await expect(dialog).toBeHidden();

	// Flow canvas with the inspector open on a choice block.
	const workspace = page.getByTestId("bot-workspace");
	await expect(workspace).toBeVisible();
	await expect(page.getByTestId("flow-canvas")).toBeVisible();
	await page.getByTestId("block-c_topic").click();
	const inspector = page.getByTestId("block-inspector");
	await expect(inspector).toBeVisible();
	await inspector.getByLabel("Button text 1").fill("Billing & invoices");
	await expect(page.getByTestId("block-c_topic")).toBeVisible();
	await expect(page.getByText("Billing & invoices").first()).toBeVisible();
	await expect(page.getByText("Unsaved changes")).toBeVisible();
	await page.screenshot({
		path: resolve(evidence, "bot-flows-canvas-inspector.png"),
	});

	// Add a block from the grouped menu and see inline validation.
	await page
		.getByTestId("inspector")
		.getByRole("button", { name: "Close" })
		.click();
	await page
		.getByTestId("group-g_start")
		.getByRole("button", { name: "+ Add block" })
		.click();
	await expect(page.getByRole("menu").getByText("Integrations")).toBeVisible();
	await page.getByRole("menuitem", { name: "Image" }).click();
	await expect(page.getByTestId("block-inspector")).toBeVisible();
	await page.getByTestId("validation-summary").click();
	await expect(
		page.getByText("Media blocks need an https:// URL.").first()
	).toBeVisible();
	await page.screenshot({
		path: resolve(evidence, "bot-flows-validation.png"),
	});
	await page
		.getByTestId("block-inspector")
		.getByRole("button", { name: "Delete" })
		.click();
	await expect(
		page.getByText("Media blocks need an https:// URL.")
	).toHaveCount(0);

	// Save, then preview the draft through the admin preview endpoints.
	await page.getByRole("button", { name: "Save draft" }).click();
	await expect(page.getByText("Draft saved.")).toBeVisible();
	await page.getByRole("button", { name: "Preview", exact: true }).click();
	const preview = page.getByTestId("preview");
	await expect(
		preview.getByText("What can I help you with today?")
	).toBeVisible();
	await preview.getByRole("button", { name: "Billing & invoices" }).click();
	await expect(
		preview.getByText("Did this answer your question?")
	).toBeVisible();
	await page.screenshot({
		path: resolve(evidence, "bot-flows-preview.png"),
		animations: "disabled",
	});
	await page.keyboard.press("Escape");
	await expect(preview).toBeHidden();

	// Generate flow (fake model) shows a summary and applies only on confirm.
	await page.getByRole("button", { name: "Generate flow" }).click();
	const generate = page.getByRole("dialog");
	await generate
		.getByLabel("Description")
		.fill("Qualify leads for a design agency and offer a call.");
	await generate.getByRole("button", { name: "Generate flow" }).click();
	await expect(generate.getByText(/Generated a valid flow with/)).toBeVisible();
	await generate.getByRole("button", { name: "Cancel" }).click();
	await expect(page.getByTestId("block-c_topic")).toBeVisible();

	// Publish.
	await page.getByRole("button", { name: "Publish", exact: true }).click();
	await expect(
		page.getByText("Published. The public link now runs this version.")
	).toBeVisible();
	const created = botDocumentSchema.parse(
		await (
			await request.get(`${SIDECAR_ORIGIN}/api/bot-flows/admin/bots`, {
				headers: admin,
			})
		)
			.json()
			.then(async (items: { id: string }[]) => {
				const response = await request.get(
					`${SIDECAR_ORIGIN}/api/bot-flows/admin/bots/${items[0]?.id}`,
					{ headers: admin }
				);
				return response.json();
			})
	);
	expect(created.status).toBe("published");

	// Share tab: link, snippets, and allowed origins.
	await page.getByRole("tab", { name: "Share" }).click();
	const share = page.getByTestId("share-panel");
	await expect(share.getByLabel("Public link")).toHaveValue(
		`${UI_ORIGIN}/bots/${created.slug}`
	);
	await expect(share.getByTestId("snippet-bubble")).toContainText(
		'RyuBotFlows.init({ mode: "bubble" })'
	);
	await share.getByLabel("Website origin").fill("https://www.example.com/");
	await share.getByRole("button", { name: "Allow" }).click();
	await expect(share.getByTestId("allowed-origins")).toContainText(
		"https://www.example.com"
	);
	await page.screenshot({
		path: resolve(evidence, "bot-flows-share.png"),
		fullPage: true,
	});

	// Knowledge articles are saved through their own route.
	await page.getByRole("tab", { name: "Knowledge" }).click();
	const knowledge = page.getByTestId("knowledge-panel");
	await expect(
		knowledge.getByRole("heading", { name: "No knowledge articles" })
	).toBeVisible();
	await knowledge.getByRole("button", { name: "Add article" }).click();
	await knowledge.getByLabel("Title 1").fill("Refunds");
	await knowledge
		.getByLabel("Content")
		.fill(
			"Refunds are issued within 14 days of purchase to the original card."
		);
	await knowledge.getByRole("button", { name: "Save knowledge" }).click();
	await expect(
		knowledge.getByText("Knowledge saved.", { exact: false })
	).toBeVisible();
	await page.screenshot({ path: resolve(evidence, "bot-flows-knowledge.png") });

	// Theme & settings.
	await page.getByRole("tab", { name: "Theme & settings" }).click();
	await expect(
		page.getByTestId("settings-panel").getByLabel("Display name")
	).toHaveValue("Support assistant");
	await page.screenshot({
		path: resolve(evidence, "bot-flows-settings.png"),
		fullPage: true,
	});

	// Seed public conversations (some finish, some drop off), then review results.
	await converse(request, created.slug, 0, 10);
	await converse(request, created.slug, 1, 10);
	await converse(request, created.slug, 0, 1);
	await converse(request, created.slug, 3, 0);
	await page.getByRole("tab", { name: "Results" }).click();
	const results = page.getByTestId("results-panel");
	await expect(results.getByText("Drop-off by question")).toBeVisible();
	await expect(results.getByRole("row")).toHaveCount(5);
	await page.screenshot({
		path: resolve(evidence, "bot-flows-results.png"),
		fullPage: true,
	});
	await results
		.getByRole("row")
		.filter({ hasText: "Handoff" })
		.getByRole("button", { name: "View" })
		.click();
	await expect(
		page.getByTestId("result-detail").getByText("Transcript")
	).toBeVisible();
	await page.screenshot({
		path: resolve(evidence, "bot-flows-transcript.png"),
		animations: "disabled",
	});
	await page.keyboard.press("Escape");

	// The bots list, with a second (draft) bot for contrast.
	await request.post(`${SIDECAR_ORIGIN}/api/bot-flows/admin/bots`, {
		headers: admin,
		data: { name: "Quarterly NPS", templateId: "nps-survey" },
	});
	// The allowed origin added on the Share tab is still an unsaved draft edit,
	// so leaving asks first instead of discarding it.
	await page.getByRole("button", { name: /All bots/ }).click();
	const leave = page.getByRole("dialog", {
		name: "Save changes before leaving?",
	});
	await expect(leave).toBeVisible();
	await leave.getByRole("button", { name: "Save and leave" }).click();
	await expect(
		page.getByRole("option", { name: /Quarterly NPS/ })
	).toBeVisible();
	const saved = botDocumentSchema.parse(
		await (
			await request.get(
				`${SIDECAR_ORIGIN}/api/bot-flows/admin/bots/${created.id}`,
				{ headers: admin }
			)
		).json()
	);
	expect(saved.flow.settings.allowedEmbedOrigins).toContain(
		"https://www.example.com"
	);
	await page.screenshot({ path: resolve(evidence, "bot-flows-list.png") });
	await page.setViewportSize({ width: 390, height: 844 });
	await page.screenshot({
		path: resolve(evidence, "bot-flows-list-narrow.png"),
	});
	await page.setViewportSize({ width: 1440, height: 900 });

	// Dark mode for the canvas.
	await page.emulateMedia({ colorScheme: "dark" });
	await page.evaluate(() => document.documentElement.classList.add("dark"));
	await page.getByRole("option", { name: /Support triage/ }).click();
	await expect(page.getByTestId("flow-canvas")).toBeVisible();
	await page.getByTestId("block-c_topic").click();
	await page.screenshot({
		path: resolve(evidence, "bot-flows-canvas-dark.png"),
	});
	await page.setViewportSize({ width: 390, height: 844 });
	await page.screenshot({
		path: resolve(evidence, "bot-flows-canvas-narrow-dark.png"),
	});
	await page.setViewportSize({ width: 1440, height: 900 });

	// The public hosted chat page, mid-conversation, in light and dark.
	for (const colorScheme of ["light", "dark"] as const) {
		const context = await browser.newContext({
			colorScheme,
			viewport: { width: 520, height: 820 },
		});
		const visitor = await context.newPage();
		const visitorErrors: string[] = [];
		visitor.on("pageerror", (error) => visitorErrors.push(error.message));
		visitor.on("console", (message) => {
			if (message.type() === "error") {
				visitorErrors.push(message.text());
			}
		});
		await visitor.goto(`${UI_ORIGIN}/bots/${created.slug}`);
		await expect(
			visitor.getByText("What can I help you with today?")
		).toBeVisible();
		await visitor.getByRole("button", { name: "Billing & invoices" }).click();
		await expect(
			visitor.getByText("Did this answer your question?")
		).toBeVisible();
		await visitor.getByRole("button", { name: /^No/ }).click();
		await expect(
			visitor.locator("#input-area input, #input-area textarea").first()
		).toBeVisible();
		await visitor.screenshot({
			path: resolve(evidence, `bot-flows-public-${colorScheme}.png`),
		});
		expect(visitorErrors).toEqual([]);
		await context.close();
	}

	expect(pageErrors).toEqual([]);
});
