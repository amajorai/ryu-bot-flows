/**
 * Bot Flows wire contracts: the Flow model, every admin/public request and
 * response shape, and the flow validator.
 *
 * This module is shared by the sidecar and the Companion UI, so it imports only
 * `zod` and the pure `./template.ts` (no Bun, Node, or DOM APIs). The UI can
 * import it either by relative path
 * (`import { flowSchema } from "../../sidecar/src/contracts.ts"` from
 * `apps-store/bot-flows/ui/src`) or through the package export
 * `@ryu/bot-flows-sidecar/contracts` after adding the workspace dependency.
 */
import { z } from "zod";
import { templateVariableNames } from "./template.ts";

export const BOT_LIMITS = {
	bots: 100,
	variables: 80,
	groups: 60,
	blocksPerGroup: 40,
	edges: 600,
	choiceItems: 20,
	conditionRules: 10,
	httpHeaders: 20,
	responseMappings: 20,
	nameLength: 120,
	textLength: 4000,
	urlLength: 2000,
	answerLength: 4000,
	hiddenValueLength: 500,
	hiddenValues: 20,
	aiPromptChars: 12_000,
	aiMaxChars: 4000,
	httpTimeoutMs: 10_000,
	httpResponseBytes: 262_144,
	waitSeconds: 30,
	stepsPerTurn: 200,
	turnsPerSession: 500,
	transcriptEntries: 400,
	logEntries: 200,
	resultsPage: 100,
	resultsPerBot: 5000,
	resultsTotal: 20_000,
	knowledgeArticles: 50,
	knowledgeTitle: 200,
	knowledgeBody: 20_000,
	sessionTtlMs: 24 * 60 * 60 * 1000,
	publicBodyBytes: 8192,
	/**
	 * The largest JSON body any route accepts. It equals the manifest's
	 * `http.max_body_bytes`, which Core's ext-proxy enforces for every route of
	 * this sidecar (public and admin alike), so every body these contracts
	 * accept also fits through Core. 50 knowledge articles at the per-article
	 * limit (about 1 MB of plain text) fit; flows and knowledge are also
	 * checked against it as a whole.
	 */
	maxBodyBytes: 1_048_576,
} as const;

/**
 * The UTF-8 size of `value` sent as a compact JSON body (how the Companion and
 * `JSON.stringify` send it). Compare it with `BOT_LIMITS.maxBodyBytes` before
 * a save so an oversized body is refused in the editor instead of by Core.
 */
export function jsonBodyBytes(value: unknown): number {
	return new TextEncoder().encode(JSON.stringify(value) ?? "").byteLength;
}

/** The message shown when a body is larger than `BOT_LIMITS.maxBodyBytes`. */
export const BODY_TOO_LARGE_MESSAGE = `This is too large to save (the limit is ${Math.floor(BOT_LIMITS.maxBodyBytes / 1024)} KiB). Shorten or remove some content.`;

const fitsBody = (value: unknown) =>
	jsonBodyBytes(value) <= BOT_LIMITS.maxBodyBytes;

/** Ids are opaque to visitors and stable across saves. */
export const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
/** Variable names are what `{{name}}` templates reference. */
export const VARIABLE_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
/** Public slug grammar (3–48 chars), matched by the sidecar router. */
export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$/;
/** Slugs that would shadow sidecar routes. */
export const RESERVED_SLUGS = [
	"admin",
	"api",
	"bots",
	"embed",
	"health",
	"preview",
	"sessions",
	"static",
	"status",
] as const;

const idSchema = z
	.string()
	.regex(ID_PATTERN, "Ids use letters, digits, - or _");
const optionalText = (max: number) => z.string().max(max).optional();

// ---------------------------------------------------------------------------
// Flow model
// ---------------------------------------------------------------------------

export const variableSchema = z
	.object({
		id: idSchema,
		name: z
			.string()
			.regex(
				VARIABLE_NAME_PATTERN,
				"Variable names start with a letter or _ and use letters, digits or _"
			),
		/** Hidden variables may be prefilled from the embed snippet or the URL. */
		hidden: z.boolean().optional(),
	})
	.strict();
export type Variable = z.infer<typeof variableSchema>;

const inputCommon = {
	id: idSchema,
	saveTo: idSchema.optional(),
	placeholder: optionalText(200),
	buttonLabel: optionalText(60),
	retryMessage: optionalText(500),
};

export const textBubbleSchema = z
	.object({
		id: idSchema,
		type: z.literal("text"),
		content: z.string().min(1).max(BOT_LIMITS.textLength),
	})
	.strict();
export const imageBubbleSchema = z
	.object({
		id: idSchema,
		type: z.literal("image"),
		url: z.string().max(BOT_LIMITS.urlLength),
		alt: z.string().max(300),
	})
	.strict();
export const videoBubbleSchema = z
	.object({
		id: idSchema,
		type: z.literal("video"),
		url: z.string().max(BOT_LIMITS.urlLength),
	})
	.strict();
export const embedBubbleSchema = z
	.object({
		id: idSchema,
		type: z.literal("embed"),
		url: z.string().max(BOT_LIMITS.urlLength),
		height: z.number().int().min(120).max(1200),
	})
	.strict();

export const textInputSchema = z
	.object({
		...inputCommon,
		type: z.literal("text_input"),
		long: z.boolean().optional(),
		minLength: z.number().int().min(0).max(BOT_LIMITS.answerLength).optional(),
		maxLength: z.number().int().min(1).max(BOT_LIMITS.answerLength).optional(),
	})
	.strict();
export const numberInputSchema = z
	.object({
		...inputCommon,
		type: z.literal("number_input"),
		min: z.number().finite().optional(),
		max: z.number().finite().optional(),
		step: z.number().finite().positive().optional(),
	})
	.strict();
export const emailInputSchema = z
	.object({ ...inputCommon, type: z.literal("email_input") })
	.strict();
export const phoneInputSchema = z
	.object({ ...inputCommon, type: z.literal("phone_input") })
	.strict();
export const urlInputSchema = z
	.object({ ...inputCommon, type: z.literal("url_input") })
	.strict();
export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export const DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
export const dateInputSchema = z
	.object({
		...inputCommon,
		type: z.literal("date_input"),
		withTime: z.boolean().optional(),
		min: z.string().regex(DATE_PATTERN, "Use YYYY-MM-DD").optional(),
		max: z.string().regex(DATE_PATTERN, "Use YYYY-MM-DD").optional(),
	})
	.strict();
export const RATING_SCALES = ["nps", "stars", "numbers"] as const;
export const ratingInputSchema = z
	.object({
		...inputCommon,
		type: z.literal("rating_input"),
		scale: z.enum(RATING_SCALES),
		/** Ignored for `nps`, which is always 0–10. */
		length: z.number().int().min(3).max(10),
		leftLabel: optionalText(60),
		rightLabel: optionalText(60),
	})
	.strict();
export const choiceItemSchema = z
	.object({
		id: idSchema,
		label: z.string().trim().min(1).max(120),
		/** Saved to the variable instead of the label when set. */
		value: optionalText(500),
	})
	.strict();
export type ChoiceItem = z.infer<typeof choiceItemSchema>;
export const choiceInputSchema = z
	.object({
		...inputCommon,
		type: z.literal("choice_input"),
		multiple: z.boolean().optional(),
		items: z.array(choiceItemSchema).min(1).max(BOT_LIMITS.choiceItems),
	})
	.strict();

export const SET_VARIABLE_OPS = [
	"set",
	"append",
	"increment",
	"clear",
	"now",
	"random_id",
	"result_id",
	"transcript",
] as const;
export const setVariableSchema = z
	.object({
		id: idSchema,
		type: z.literal("set_variable"),
		variableId: idSchema,
		op: z.enum(SET_VARIABLE_OPS),
		value: optionalText(2000),
	})
	.strict();
export const CONDITION_OPERATORS = [
	"equals",
	"not_equals",
	"contains",
	"not_contains",
	"greater_than",
	"less_than",
	"is_set",
	"is_empty",
	"starts_with",
	"ends_with",
] as const;
export type ConditionOperator = (typeof CONDITION_OPERATORS)[number];
export const conditionRuleSchema = z
	.object({
		variableId: idSchema,
		operator: z.enum(CONDITION_OPERATORS),
		value: optionalText(500),
	})
	.strict();
export type ConditionRule = z.infer<typeof conditionRuleSchema>;
export const conditionSchema = z
	.object({
		id: idSchema,
		type: z.literal("condition"),
		combinator: z.enum(["and", "or"]),
		rules: z.array(conditionRuleSchema).min(1).max(BOT_LIMITS.conditionRules),
	})
	.strict();
export const redirectSchema = z
	.object({
		id: idSchema,
		type: z.literal("redirect"),
		url: z.string().min(1).max(BOT_LIMITS.urlLength),
		newTab: z.boolean(),
	})
	.strict();
export const jumpSchema = z
	.object({ id: idSchema, type: z.literal("jump"), groupId: idSchema })
	.strict();
export const waitSchema = z
	.object({
		id: idSchema,
		type: z.literal("wait"),
		seconds: z.number().min(0).max(BOT_LIMITS.waitSeconds),
	})
	.strict();
export const abTestSchema = z
	.object({
		id: idSchema,
		type: z.literal("ab_test"),
		percentA: z.number().int().min(0).max(100),
	})
	.strict();

export const aiReplySchema = z
	.object({
		id: idSchema,
		type: z.literal("ai_reply"),
		/** Owner-set system prompt. Visitors can never change it or the model. */
		instructions: z.string().max(4000),
		promptTemplate: z.string().min(1).max(BOT_LIMITS.aiPromptChars),
		saveTo: idSchema.optional(),
		useKnowledge: z.boolean(),
		maxChars: z.number().int().min(50).max(BOT_LIMITS.aiMaxChars),
		/** Shown when the model fails or the AI budget is used up. */
		fallbackMessage: optionalText(500),
	})
	.strict();
export const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
export const httpRequestSchema = z
	.object({
		id: idSchema,
		type: z.literal("http_request"),
		method: z.enum(HTTP_METHODS),
		url: z.string().min(1).max(BOT_LIMITS.urlLength),
		headers: z
			.array(
				z
					.object({
						name: z
							.string()
							.regex(
								/^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,100}$/,
								"Invalid header name"
							),
						value: z.string().max(2000),
					})
					.strict()
			)
			.max(BOT_LIMITS.httpHeaders),
		body: z.string().max(20_000),
		responseMapping: z
			.array(
				z
					.object({ path: z.string().min(1).max(200), variableId: idSchema })
					.strict()
			)
			.max(BOT_LIMITS.responseMappings),
		timeoutMs: z.number().int().min(500).max(BOT_LIMITS.httpTimeoutMs),
	})
	.strict();
export const handoffSchema = z
	.object({
		id: idSchema,
		type: z.literal("handoff"),
		topic: z.string().trim().min(1).max(80),
		summaryTemplate: z.string().max(2000),
		message: z.string().max(2000),
	})
	.strict();

export const blockSchema = z.discriminatedUnion("type", [
	textBubbleSchema,
	imageBubbleSchema,
	videoBubbleSchema,
	embedBubbleSchema,
	textInputSchema,
	numberInputSchema,
	emailInputSchema,
	phoneInputSchema,
	urlInputSchema,
	dateInputSchema,
	ratingInputSchema,
	choiceInputSchema,
	setVariableSchema,
	conditionSchema,
	redirectSchema,
	jumpSchema,
	waitSchema,
	abTestSchema,
	aiReplySchema,
	httpRequestSchema,
	handoffSchema,
]);
export type Block = z.infer<typeof blockSchema>;
export type BlockType = Block["type"];
export type BlockOf<T extends BlockType> = Extract<Block, { type: T }>;

export const BLOCK_CATEGORIES = {
	bubbles: ["text", "image", "video", "embed"],
	inputs: [
		"text_input",
		"number_input",
		"email_input",
		"phone_input",
		"url_input",
		"date_input",
		"rating_input",
		"choice_input",
	],
	logic: ["set_variable", "condition", "redirect", "jump", "wait", "ab_test"],
	integrations: ["ai_reply", "http_request", "handoff"],
} as const satisfies Record<string, readonly BlockType[]>;

export const INPUT_BLOCK_TYPES = BLOCK_CATEGORIES.inputs;
export type InputBlockType = (typeof INPUT_BLOCK_TYPES)[number];
export type InputBlock = BlockOf<InputBlockType>;

export function isInputBlock(block: Block): block is InputBlock {
	return (INPUT_BLOCK_TYPES as readonly string[]).includes(block.type);
}

export const EDGE_BRANCHES = ["true", "false", "a", "b", "default"] as const;
export type EdgeBranch = (typeof EDGE_BRANCHES)[number];
export const edgeSchema = z
	.object({
		id: idSchema,
		from: z
			.object({
				blockId: idSchema,
				itemId: idSchema.optional(),
				branch: z.enum(EDGE_BRANCHES).optional(),
			})
			.strict(),
		to: z.object({ groupId: idSchema }).strict(),
	})
	.strict();
export type Edge = z.infer<typeof edgeSchema>;

export const groupSchema = z
	.object({
		id: idSchema,
		title: z.string().max(BOT_LIMITS.nameLength),
		position: z
			.object({
				x: z.number().finite(),
				y: z.number().finite(),
			})
			.strict(),
		blocks: z.array(blockSchema).max(BOT_LIMITS.blocksPerGroup),
	})
	.strict();
export type Group = z.infer<typeof groupSchema>;

export const themeSchema = z
	.object({
		accent: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a #rrggbb color"),
		botName: z.string().trim().min(1).max(80),
		/** Must be an https URL to be shown; validateFlow reports anything else. */
		avatarUrl: optionalText(BOT_LIMITS.urlLength),
		mode: z.enum(["auto", "light", "dark"]).default("auto"),
		typingDelayMs: z.number().int().min(0).max(1500).default(400),
	})
	.strict();
export type Theme = z.infer<typeof themeSchema>;

/** An exact `https://host[:port]` origin with no path. */
export function isHttpsOrigin(value: string): boolean {
	try {
		const url = new URL(value);
		return url.protocol === "https:" && url.origin === value;
	} catch {
		return false;
	}
}

export const settingsSchema = z
	.object({
		invalidReplyMessage: z.string().trim().min(1).max(500),
		allowedEmbedOrigins: z
			.array(
				z
					.string()
					.refine(isHttpsOrigin, "Embed origins look like https://example.com")
			)
			.max(20),
		aiTurnsPerConversation: z.number().int().min(0).max(20).default(5),
		aiTurnsPerDay: z.number().int().min(0).max(5000).default(200),
		closedMessage: z.string().trim().min(1).max(500),
	})
	.strict();
export type Settings = z.infer<typeof settingsSchema>;

export const flowSchema = z
	.object({
		version: z.literal(1),
		variables: z.array(variableSchema).max(BOT_LIMITS.variables),
		groups: z.array(groupSchema).min(1).max(BOT_LIMITS.groups),
		edges: z.array(edgeSchema).max(BOT_LIMITS.edges),
		startGroupId: idSchema,
		theme: themeSchema,
		settings: settingsSchema,
	})
	.strict();
export type Flow = z.infer<typeof flowSchema>;
export type FlowInput = z.input<typeof flowSchema>;

export const DEFAULT_THEME: Theme = {
	accent: "#2563eb",
	botName: "Assistant",
	mode: "auto",
	typingDelayMs: 400,
};

export const DEFAULT_SETTINGS: Settings = {
	invalidReplyMessage: "That doesn't look right. Please try again.",
	allowedEmbedOrigins: [],
	aiTurnsPerConversation: 5,
	aiTurnsPerDay: 200,
	closedMessage: "This bot isn't taking conversations right now.",
};

// ---------------------------------------------------------------------------
// Flow validation (publish gate and inline editor issues)
// ---------------------------------------------------------------------------

export interface FlowIssue {
	blockId?: string;
	edgeId?: string;
	groupId?: string;
	message: string;
	severity: "error" | "warning";
}

const BRANCHES_BY_TYPE: Partial<Record<BlockType, readonly EdgeBranch[]>> = {
	condition: ["true", "false"],
	ab_test: ["a", "b"],
	choice_input: ["default"],
};

function isHttpsUrl(value: string): boolean {
	try {
		return new URL(value).protocol === "https:";
	} catch {
		return false;
	}
}

/** Strings a block renders through `{{var}}` templates. */
export function blockTemplates(block: Block): string[] {
	switch (block.type) {
		case "text":
			return [block.content];
		case "redirect":
			return [block.url];
		case "set_variable":
			return block.value ? [block.value] : [];
		case "condition":
			return block.rules.flatMap((rule) => (rule.value ? [rule.value] : []));
		case "ai_reply":
			return [block.promptTemplate, block.instructions];
		case "http_request":
			return [
				block.url,
				block.body,
				...block.headers.map((header) => header.value),
			];
		case "handoff":
			return [block.summaryTemplate, block.message, block.topic];
		default:
			return [];
	}
}

/** Variable ids a block reads or writes directly. */
function blockVariableIds(block: Block): string[] {
	switch (block.type) {
		case "set_variable":
			return [block.variableId];
		case "condition":
			return block.rules.map((rule) => rule.variableId);
		case "http_request":
			return block.responseMapping.map((mapping) => mapping.variableId);
		default:
			return "saveTo" in block && block.saveTo ? [block.saveTo] : [];
	}
}

function validateBlockShape(block: Block, issues: FlowIssue[]): void {
	const issue = (message: string, severity: FlowIssue["severity"] = "error") =>
		issues.push({ blockId: block.id, message, severity });
	switch (block.type) {
		case "image":
		case "video":
		case "embed":
			if (!isHttpsUrl(block.url)) {
				issue("Media blocks need an https:// URL.");
			}
			break;
		case "redirect":
			if (
				!(block.url.includes("{{") || /^https?:\/\//i.test(block.url.trim()))
			) {
				issue("Redirects need an http:// or https:// URL.");
			}
			break;
		case "http_request":
			if (!/^https:\/\//i.test(block.url.trim())) {
				issue("HTTP requests must use an https:// URL.");
			}
			break;
		case "number_input":
			if (
				block.min !== undefined &&
				block.max !== undefined &&
				block.min > block.max
			) {
				issue("The minimum is larger than the maximum.");
			}
			break;
		case "text_input":
			if (
				block.minLength !== undefined &&
				block.maxLength !== undefined &&
				block.minLength > block.maxLength
			) {
				issue("The minimum length is larger than the maximum length.");
			}
			break;
		case "date_input":
			if (block.min && block.max && block.min > block.max) {
				issue("The earliest date is after the latest date.");
			}
			break;
		case "choice_input": {
			const ids = block.items.map((item) => item.id);
			if (new Set(ids).size !== ids.length) {
				issue("Choice items need unique ids.");
			}
			break;
		}
		default:
			break;
	}
	if (isInputBlock(block) && !block.saveTo) {
		issue(
			"This answer isn't saved to a variable. It still appears in results.",
			"warning"
		);
	}
}

function validateEdges(
	flow: Flow,
	blocks: Map<string, Block>,
	groupIds: Set<string>,
	issues: FlowIssue[]
): void {
	const sources = new Set<string>();
	for (const edge of flow.edges) {
		const block = blocks.get(edge.from.blockId);
		const issue = (message: string) =>
			issues.push({
				edgeId: edge.id,
				blockId: edge.from.blockId,
				message,
				severity: "error",
			});
		if (!block) {
			issue("This connection starts at a block that no longer exists.");
			continue;
		}
		if (!groupIds.has(edge.to.groupId)) {
			issue("This connection points to a group that no longer exists.");
		}
		if (edge.from.itemId) {
			if (block.type !== "choice_input" || block.multiple) {
				issue("Only single-choice items have their own connections.");
			} else if (!block.items.some((item) => item.id === edge.from.itemId)) {
				issue("This connection starts at a choice item that no longer exists.");
			}
		}
		if (edge.from.branch) {
			const allowed = BRANCHES_BY_TYPE[block.type] ?? [];
			if (
				!allowed.includes(edge.from.branch) ||
				(block.type === "choice_input" && block.multiple)
			) {
				issue(`A ${block.type} block has no "${edge.from.branch}" branch.`);
			}
		}
		const key = `${edge.from.blockId}|${edge.from.itemId ?? ""}|${edge.from.branch ?? ""}`;
		if (sources.has(key)) {
			issue("Two connections leave the same handle.");
		}
		sources.add(key);
	}
}

function reachableGroups(flow: Flow): Set<string> {
	const groups = new Map(flow.groups.map((group) => [group.id, group]));
	const seen = new Set<string>();
	const queue = [flow.startGroupId];
	while (queue.length > 0) {
		const groupId = queue.shift() as string;
		const group = groups.get(groupId);
		if (!group || seen.has(groupId)) {
			continue;
		}
		seen.add(groupId);
		const blockIds = new Set(group.blocks.map((block) => block.id));
		for (const edge of flow.edges) {
			if (blockIds.has(edge.from.blockId)) {
				queue.push(edge.to.groupId);
			}
		}
		for (const block of group.blocks) {
			if (block.type === "jump") {
				queue.push(block.groupId);
			}
		}
	}
	return seen;
}

/**
 * Reports integrity problems in a flow. A flow with any `error` cannot be
 * published; `warning`s are shown inline in the editor only.
 */
export function validateFlow(flow: Flow): FlowIssue[] {
	const issues: FlowIssue[] = [];
	const variableIds = new Set<string>();
	const variableNames = new Set<string>();
	for (const variable of flow.variables) {
		if (variableIds.has(variable.id)) {
			issues.push({
				message: `Duplicate variable id "${variable.id}".`,
				severity: "error",
			});
		}
		if (variableNames.has(variable.name)) {
			issues.push({
				message: `Two variables are named "${variable.name}".`,
				severity: "error",
			});
		}
		variableIds.add(variable.id);
		variableNames.add(variable.name);
	}
	const groupIds = new Set<string>();
	const blocks = new Map<string, Block>();
	for (const group of flow.groups) {
		if (groupIds.has(group.id)) {
			issues.push({
				groupId: group.id,
				message: "Duplicate group id.",
				severity: "error",
			});
		}
		groupIds.add(group.id);
		if (group.blocks.length === 0) {
			issues.push({
				groupId: group.id,
				message: "This group has no blocks.",
				severity: "warning",
			});
		}
		for (const block of group.blocks) {
			if (blocks.has(block.id)) {
				issues.push({
					blockId: block.id,
					groupId: group.id,
					message: "Duplicate block id.",
					severity: "error",
				});
			}
			blocks.set(block.id, block);
		}
	}
	if (!groupIds.has(flow.startGroupId)) {
		issues.push({
			message: "The start group no longer exists.",
			severity: "error",
		});
	}
	for (const block of blocks.values()) {
		validateBlockShape(block, issues);
		for (const variableId of blockVariableIds(block)) {
			if (!variableIds.has(variableId)) {
				issues.push({
					blockId: block.id,
					message: "This block uses a variable that no longer exists.",
					severity: "error",
				});
			}
		}
		if (block.type === "jump" && !groupIds.has(block.groupId)) {
			issues.push({
				blockId: block.id,
				message: "This jump points to a group that no longer exists.",
				severity: "error",
			});
		}
		for (const template of blockTemplates(block)) {
			for (const name of templateVariableNames(template)) {
				if (!variableNames.has(name)) {
					issues.push({
						blockId: block.id,
						message: `{{${name}}} isn't a variable in this bot.`,
						severity: "warning",
					});
				}
			}
		}
	}
	validateEdges(flow, blocks, groupIds, issues);
	const reachable = reachableGroups(flow);
	for (const group of flow.groups) {
		if (!reachable.has(group.id)) {
			issues.push({
				groupId: group.id,
				message: "Nothing leads to this group.",
				severity: "warning",
			});
		}
	}
	return issues;
}

export function flowErrors(flow: Flow): FlowIssue[] {
	return validateFlow(flow).filter((issue) => issue.severity === "error");
}

export function blockCount(flow: Flow): number {
	return flow.groups.reduce((total, group) => total + group.blocks.length, 0);
}

// ---------------------------------------------------------------------------
// Runtime wire types (engine turns, results)
// ---------------------------------------------------------------------------

/** What the visitor sees for the pending input (owner-only fields removed). */
export const inputSpecSchema = z.discriminatedUnion("type", [
	textInputSchema.omit({ saveTo: true, retryMessage: true }),
	numberInputSchema.omit({ saveTo: true, retryMessage: true }),
	emailInputSchema.omit({ saveTo: true, retryMessage: true }),
	phoneInputSchema.omit({ saveTo: true, retryMessage: true }),
	urlInputSchema.omit({ saveTo: true, retryMessage: true }),
	dateInputSchema.omit({ saveTo: true, retryMessage: true }),
	ratingInputSchema.omit({ saveTo: true, retryMessage: true }),
	choiceInputSchema.omit({ saveTo: true, retryMessage: true }),
]);
export type InputSpec = z.infer<typeof inputSpecSchema>;

export const botMessageSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("text"),
		id: z.string(),
		/** Plain text with minimal **bold**, *italic* and [link](https://…) markers. */
		content: z.string(),
		source: z.enum(["bot", "ai", "system"]),
	}),
	z.object({
		type: z.literal("image"),
		id: z.string(),
		url: z.string(),
		alt: z.string(),
	}),
	z.object({
		type: z.literal("video"),
		id: z.string(),
		url: z.string(),
		/** YouTube/Vimeo player URL, or null for a direct video file. */
		embedUrl: z.string().nullable(),
	}),
	z.object({
		type: z.literal("embed"),
		id: z.string(),
		url: z.string(),
		height: z.number(),
	}),
	z.object({
		type: z.literal("wait"),
		id: z.string(),
		seconds: z.number(),
	}),
]);
export type BotMessage = z.infer<typeof botMessageSchema>;

export const redirectActionSchema = z.object({
	url: z.string(),
	newTab: z.boolean(),
});
export type RedirectAction = z.infer<typeof redirectActionSchema>;

export const answerSchema = z.object({
	blockId: z.string(),
	variableId: z.string().optional(),
	/** Human-readable answer, e.g. the chosen item labels. */
	label: z.string(),
	/** Stored value, e.g. a choice item's `value`. */
	value: z.string(),
	at: z.string(),
});
export type Answer = z.infer<typeof answerSchema>;

export const transcriptEntrySchema = z.object({
	from: z.enum(["bot", "visitor"]),
	text: z.string(),
	at: z.string(),
	blockId: z.string().optional(),
});
export type TranscriptEntry = z.infer<typeof transcriptEntrySchema>;

export const resultLogSchema = z.object({
	blockId: z.string(),
	kind: z.enum(["ai", "http", "redirect", "media", "engine"]),
	level: z.enum(["info", "error"]),
	message: z.string(),
	at: z.string(),
});
export type ResultLog = z.infer<typeof resultLogSchema>;

export const handoffRecordSchema = z.object({
	blockId: z.string(),
	topic: z.string(),
	summary: z.string(),
	at: z.string(),
});
export type HandoffRecord = z.infer<typeof handoffRecordSchema>;

export const blockEventSchema = z.object({
	blockId: z.string(),
	type: z.enum(["reached", "answered"]),
	at: z.string(),
});
export type BlockEvent = z.infer<typeof blockEventSchema>;

const cursorSchema = z.object({
	groupId: z.string(),
	blockIndex: z.number().int().min(0),
});

/** Persisted engine state. Never sent to visitors. */
export const sessionStateSchema = z.object({
	version: z.literal(1),
	resultId: z.string(),
	/** The input block awaiting a reply, or null when none is pending. */
	pending: cursorSchema.nullable(),
	variables: z.record(z.string(), z.string()),
	answers: z.array(answerSchema),
	transcript: z.array(transcriptEntrySchema),
	logs: z.array(resultLogSchema),
	handoffs: z.array(handoffRecordSchema),
	events: z.array(blockEventSchema),
	/** The last block run or answered; `events` is deduplicated, this is not. */
	lastBlockId: z.string().nullable().optional(),
	aiTurns: z.number().int().min(0),
	turns: z.number().int().min(0),
	done: z.boolean(),
	startedAt: z.string(),
	completedAt: z.string().nullable(),
});
export type SessionState = z.infer<typeof sessionStateSchema>;

export const publicTurnSchema = z.object({
	sessionId: z.string(),
	messages: z.array(botMessageSchema),
	input: inputSpecSchema.nullable(),
	redirect: redirectActionSchema.nullable(),
	done: z.boolean(),
	expiresAt: z.string(),
});
export type PublicTurn = z.infer<typeof publicTurnSchema>;

/** Admin preview turns also expose the run's variables (by name) and logs. */
export const previewTurnSchema = publicTurnSchema.extend({
	resultId: z.string(),
	variables: z.record(z.string(), z.string()),
	logs: z.array(resultLogSchema),
	handoffs: z.array(handoffRecordSchema),
});
export type PreviewTurn = z.infer<typeof previewTurnSchema>;

// ---------------------------------------------------------------------------
// Request bodies
// ---------------------------------------------------------------------------

export const BOT_TEMPLATE_IDS = [
	"blank",
	"support-triage",
	"lead-capture",
	"nps-survey",
	"appointment-request",
	"product-quiz",
	"bug-report",
	"onboarding",
	"contact-form",
	"ai-faq",
] as const;
export type BotTemplateId = (typeof BOT_TEMPLATE_IDS)[number];

const slugInputSchema = z
	.string()
	.trim()
	.toLowerCase()
	.regex(SLUG_PATTERN, "Links use 3-48 lowercase letters, digits or -")
	.refine(
		(slug) => !(RESERVED_SLUGS as readonly string[]).includes(slug),
		"This link is reserved"
	);

export const createBotSchema = z
	.object({
		name: z.string().trim().min(1).max(BOT_LIMITS.nameLength),
		slug: slugInputSchema.optional(),
		templateId: z.enum(BOT_TEMPLATE_IDS).optional(),
		flow: flowSchema.optional(),
	})
	.strict()
	.refine((body) => !(body.templateId && body.flow), {
		message: "Send a template or a flow, not both",
	})
	.refine(fitsBody, { message: BODY_TOO_LARGE_MESSAGE });
export type CreateBotBody = z.input<typeof createBotSchema>;

export const updateBotSchema = z
	.object({
		/** The draft revision the editor last loaded (optimistic concurrency). */
		revision: z.number().int().min(0),
		name: z.string().trim().min(1).max(BOT_LIMITS.nameLength).optional(),
		slug: slugInputSchema.optional(),
		flow: flowSchema.optional(),
	})
	.strict()
	.refine(fitsBody, { message: BODY_TOO_LARGE_MESSAGE });
export type UpdateBotBody = z.input<typeof updateBotSchema>;

export const publishBotSchema = z
	.object({
		/** The draft revision the editor shows; publishing refuses any other. */
		revision: z.number().int().min(0).optional(),
	})
	.strict();
export type PublishBotBody = z.input<typeof publishBotSchema>;

const hiddenValuesSchema = z
	.record(z.string().max(64), z.string().max(BOT_LIMITS.hiddenValueLength))
	.refine(
		(values) => Object.keys(values).length <= BOT_LIMITS.hiddenValues,
		"Too many prefilled values"
	);

export const startSessionSchema = z
	.object({
		hidden: hiddenValuesSchema.optional(),
		/** Honeypot: people never fill it. */
		website: z.string().max(500).optional(),
	})
	.strict();
export type StartSessionBody = z.input<typeof startSessionSchema>;

export const replyValueSchema = z.union([
	z.string().max(BOT_LIMITS.answerLength),
	z.array(z.string().max(64)).max(BOT_LIMITS.choiceItems),
]);
export type ReplyValue = z.infer<typeof replyValueSchema>;

export const replySchema = z.object({ value: replyValueSchema }).strict();
export type ReplyBody = z.input<typeof replySchema>;

export const knowledgeArticleSchema = z
	.object({
		id: idSchema,
		title: z.string().trim().min(1).max(BOT_LIMITS.knowledgeTitle),
		body: z.string().trim().min(1).max(BOT_LIMITS.knowledgeBody),
	})
	.strict();
export type KnowledgeArticle = z.infer<typeof knowledgeArticleSchema>;

export const putKnowledgeSchema = z
	.object({
		articles: z
			.array(knowledgeArticleSchema.extend({ id: idSchema.optional() }))
			.max(BOT_LIMITS.knowledgeArticles),
	})
	.strict()
	.refine(fitsBody, { message: BODY_TOO_LARGE_MESSAGE });
export type PutKnowledgeBody = z.input<typeof putKnowledgeSchema>;

export type BotFlowsAdminRequestBody =
	| CreateBotBody
	| UpdateBotBody
	| PublishBotBody
	| PutKnowledgeBody
	| StartSessionBody
	| ReplyBody;

// ---------------------------------------------------------------------------
// Admin responses
// ---------------------------------------------------------------------------

export const botDocumentSchema = z.object({
	id: z.string(),
	slug: z.string(),
	name: z.string(),
	status: z.enum(["draft", "published"]),
	/** The draft flow the editor works on. */
	flow: flowSchema,
	/** Draft revision; bumps on every draft save. */
	revision: z.number().int(),
	publishedAt: z.string().nullable(),
	/** True when the draft differs from the published snapshot. */
	hasUnpublishedChanges: z.boolean(),
	createdAt: z.string(),
	updatedAt: z.string(),
});
export type BotDocument = z.infer<typeof botDocumentSchema>;

export const botListItemSchema = botDocumentSchema.omit({ flow: true }).extend({
	blockCount: z.number().int(),
	resultCount: z.number().int(),
	completedCount: z.number().int(),
});
export type BotListItem = z.infer<typeof botListItemSchema>;

export const botTemplateSchema = z.object({
	id: z.enum(BOT_TEMPLATE_IDS),
	name: z.string(),
	description: z.string(),
	category: z.string(),
	groupCount: z.number().int(),
	blockCount: z.number().int(),
	flow: flowSchema,
});
export type BotTemplate = z.infer<typeof botTemplateSchema>;

export const resultSummarySchema = z.object({
	id: z.string(),
	startedAt: z.string(),
	updatedAt: z.string(),
	completedAt: z.string().nullable(),
	lastBlockId: z.string().nullable(),
	answerCount: z.number().int(),
	handoffCount: z.number().int(),
	/** The first few answers, for the results table. */
	preview: z.string(),
});
export type ResultSummary = z.infer<typeof resultSummarySchema>;

export const resultPageSchema = z.object({
	items: z.array(resultSummarySchema),
	nextCursor: z.string().nullable(),
});
export type ResultPage = z.infer<typeof resultPageSchema>;

export const resultDetailSchema = resultSummarySchema
	.omit({ preview: true })
	.extend({
		botId: z.string(),
		answers: z.array(answerSchema),
		/** Variable values keyed by variable name. */
		variables: z.record(z.string(), z.string()),
		transcript: z.array(transcriptEntrySchema),
		handoffs: z.array(handoffRecordSchema),
		logs: z.array(resultLogSchema),
	});
export type ResultDetail = z.infer<typeof resultDetailSchema>;

export const blockDropOffSchema = z.object({
	blockId: z.string(),
	groupId: z.string(),
	groupTitle: z.string(),
	type: z.string(),
	label: z.string(),
	reached: z.number().int(),
	answered: z.number().int(),
	/** Share of visitors who reached the block but never answered it (0–1). */
	dropOff: z.number(),
});
export type BlockDropOff = z.infer<typeof blockDropOffSchema>;

export const botAnalyticsSchema = z.object({
	/** Hosted page loads. Embeds count when the iframe loads. */
	views: z.number().int(),
	/** Conversations started. */
	started: z.number().int(),
	/** Conversations with at least one answer. */
	engaged: z.number().int(),
	completed: z.number().int(),
	/** completed / started, or 0. */
	completionRate: z.number(),
	handoffs: z.number().int(),
	blocks: z.array(blockDropOffSchema),
});
export type BotAnalytics = z.infer<typeof botAnalyticsSchema>;

export const knowledgeDocumentSchema = z.object({
	articles: z.array(knowledgeArticleSchema),
	updatedAt: z.string().nullable(),
});
export type KnowledgeDocument = z.infer<typeof knowledgeDocumentSchema>;

export const exportTableSchema = z.object({
	columns: z.array(z.string()),
	rows: z.array(z.array(z.string())),
});
export type ExportTable = z.infer<typeof exportTableSchema>;

export const botStatusSchema = z.object({
	status: z.literal("ready"),
	botCount: z.number().int(),
	publishedCount: z.number().int(),
	aiAvailable: z.boolean(),
});
export type BotStatus = z.infer<typeof botStatusSchema>;

export const botDeleteResponseSchema = z.object({ deleted: z.literal(true) });

export const botErrorResponseSchema = z.object({
	error: z.object({
		code: z.string(),
		message: z.string(),
		issues: z
			.array(
				z.object({
					blockId: z.string().optional(),
					edgeId: z.string().optional(),
					groupId: z.string().optional(),
					message: z.string(),
					severity: z.enum(["error", "warning"]),
				})
			)
			.optional(),
	}),
});
export type BotErrorResponse = z.infer<typeof botErrorResponseSchema>;

export type BotFlowsAdminResponse =
	| BotStatus
	| BotTemplate[]
	| BotListItem[]
	| BotDocument
	| PreviewTurn
	| ResultPage
	| ResultDetail
	| BotAnalytics
	| KnowledgeDocument
	| ExportTable
	| z.infer<typeof botDeleteResponseSchema>
	| BotErrorResponse;
