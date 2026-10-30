/**
 * Preconfigured bot flows. Every template is a complete, valid Flow that walks
 * to an end (the tests prove both). Placeholder URLs use example.com so owners
 * can see what to edit.
 */
import {
	type Block,
	type BlockOf,
	type BotTemplate,
	type BotTemplateId,
	blockCount,
	type ChoiceItem,
	DEFAULT_SETTINGS,
	DEFAULT_THEME,
	type Edge,
	type EdgeBranch,
	type Flow,
	type Group,
	type Theme,
	type Variable,
} from "./contracts.ts";

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

const text = (id: string, content: string): BlockOf<"text"> => ({
	id,
	type: "text",
	content,
});

const items = (...pairs: [id: string, label: string, value?: string][]) =>
	pairs.map(
		([id, label, value]): ChoiceItem =>
			value === undefined ? { id, label } : { id, label, value }
	);

const choice = (
	id: string,
	saveTo: string,
	choices: ChoiceItem[],
	multiple = false
): BlockOf<"choice_input"> => ({
	id,
	type: "choice_input",
	saveTo,
	items: choices,
	...(multiple ? { multiple: true, buttonLabel: "Send" } : {}),
});

const textInput = (
	id: string,
	saveTo: string,
	placeholder: string,
	options: { long?: boolean; maxLength?: number } = {}
): BlockOf<"text_input"> => ({
	id,
	type: "text_input",
	saveTo,
	placeholder,
	...options,
});

const emailInput = (id: string, saveTo: string): BlockOf<"email_input"> => ({
	id,
	type: "email_input",
	saveTo,
	placeholder: "you@example.com",
	retryMessage: "That email doesn't look right. Please check it.",
});

const setVar = (
	id: string,
	variableId: string,
	op: BlockOf<"set_variable">["op"],
	value?: string
): BlockOf<"set_variable"> => ({
	id,
	type: "set_variable",
	variableId,
	op,
	...(value === undefined ? {} : { value }),
});

const jump = (id: string, groupId: string): BlockOf<"jump"> => ({
	id,
	type: "jump",
	groupId,
});

const handoff = (
	id: string,
	topic: string,
	summaryTemplate: string,
	message: string
): BlockOf<"handoff"> => ({
	id,
	type: "handoff",
	topic,
	summaryTemplate,
	message,
});

const redirect = (id: string, url: string): BlockOf<"redirect"> => ({
	id,
	type: "redirect",
	url,
	newTab: true,
});

function group(
	id: string,
	title: string,
	column: number,
	row: number,
	blocks: Block[]
): Group {
	return { id, title, position: { x: column * 360, y: row * 260 }, blocks };
}

function vars(...names: string[]): Variable[] {
	return names.map((name) => {
		const hidden = name.startsWith("?");
		const clean = hidden ? name.slice(1) : name;
		return hidden
			? { id: `v_${clean}`, name: clean, hidden }
			: { id: `v_${clean}`, name: clean };
	});
}

function edges(
	...specs: [
		from: string,
		to: string,
		handle?: { item?: string; branch?: EdgeBranch },
	][]
): Edge[] {
	return specs.map(([from, to, handle], index) => ({
		id: `e${index + 1}`,
		from: {
			blockId: from,
			...(handle?.item ? { itemId: handle.item } : {}),
			...(handle?.branch ? { branch: handle.branch } : {}),
		},
		to: { groupId: to },
	}));
}

function flow(
	theme: Partial<Theme>,
	variables: Variable[],
	groups: Group[],
	flowEdges: Edge[]
): Flow {
	return {
		version: 1,
		variables,
		groups,
		edges: flowEdges,
		startGroupId: groups[0]?.id ?? "g_start",
		theme: { ...DEFAULT_THEME, ...theme },
		settings: { ...DEFAULT_SETTINGS, allowedEmbedOrigins: [] },
	};
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

function blankFlow(): Flow {
	return flow(
		{},
		[],
		[
			group("g_start", "Start", 0, 0, [
				text("t_welcome", "Hi there! How can I help you today?"),
			]),
		],
		[]
	);
}

function supportTriage(): Flow {
	const faq = (id: string, title: string, row: number, lines: string[]) =>
		group(id, title, 1, row, [
			...lines.map((line, index) => text(`${id}_t${index + 1}`, line)),
			jump(`${id}_j`, "g_helped"),
		]);
	return flow(
		{ botName: "Support assistant", accent: "#2563eb" },
		vars("topic", "helped", "csat", "email", "issue", "ai_answer"),
		[
			group("g_start", "Welcome", 0, 0, [
				text(
					"t_hello",
					"Hi! I'm the support assistant. What can I help you with today?"
				),
				choice(
					"c_topic",
					"v_topic",
					items(
						["i_billing", "Billing"],
						["i_technical", "Technical problem"],
						["i_account", "My account"],
						["i_other", "Something else"]
					)
				),
			]),
			faq("g_faq_billing", "Billing FAQ", 0, [
				"Invoices are emailed on the first of each month and are always available under **Settings → Billing**.",
				"To change your plan or card, open **Settings → Billing** and choose *Manage subscription*.",
			]),
			faq("g_faq_technical", "Technical FAQ", 1, [
				"Most problems clear up after signing out and back in, or refreshing the page.",
				"Our status page lists any ongoing incidents: [status page](https://example.com/status).",
			]),
			faq("g_faq_account", "Account FAQ", 2, [
				"You can reset your password from the sign-in page with *Forgot password*.",
				"To change your email, open **Settings → Profile**.",
			]),
			group("g_helped", "Did this help?", 2, 0, [
				text("t_helped", "Did this answer your question?"),
				choice(
					"c_helped",
					"v_helped",
					items(["i_yes", "Yes, thanks", "yes"], ["i_no", "No", "no"])
				),
			]),
			group("g_csat", "Satisfaction", 3, 0, [
				text("t_csat", "Great! How would you rate your experience?"),
				{
					id: "r_csat",
					type: "rating_input",
					saveTo: "v_csat",
					scale: "stars",
					length: 5,
					leftLabel: "Poor",
					rightLabel: "Great",
				},
				text("t_bye", "Thanks for the feedback. Have a great day!"),
			]),
			group("g_contact", "Contact support", 3, 1, [
				text(
					"t_sorry",
					"Sorry about that. Let's get this to the team. What's your email?"
				),
				emailInput("in_email", "v_email"),
				text("t_issue", "Please describe the issue in a few sentences."),
				textInput("in_issue", "v_issue", "What happened?", { long: true }),
				{
					id: "ai_suggest",
					type: "ai_reply",
					instructions:
						"You are a friendly support agent. Suggest one or two concrete next steps based on the knowledge base. If the knowledge base doesn't cover it, say a teammate will follow up.",
					promptTemplate: "Topic: {{topic}}\nCustomer issue: {{issue}}",
					saveTo: "v_ai_answer",
					useKnowledge: true,
					maxChars: 800,
					fallbackMessage: "A teammate will look into this.",
				},
				handoff(
					"h_support",
					"support",
					"{{topic}} issue from {{email}}: {{issue}}",
					"I've passed this to our support team. We'll reply to {{email}} soon."
				),
			]),
		],
		edges(
			["c_topic", "g_faq_billing", { item: "i_billing" }],
			["c_topic", "g_faq_technical", { item: "i_technical" }],
			["c_topic", "g_faq_account", { item: "i_account" }],
			["c_topic", "g_contact", { item: "i_other" }],
			["c_helped", "g_csat", { item: "i_yes" }],
			["c_helped", "g_contact", { item: "i_no" }]
		)
	);
}

function leadCapture(): Flow {
	const bonus = (id: string, row: number, points: string, next: string) =>
		group(id, "Add to score", 2, row, [
			setVar(`${id}_inc`, "v_score", "increment", points),
			jump(`${id}_j`, next),
		]);
	return flow(
		{ botName: "Sales assistant", accent: "#7c3aed" },
		vars(
			"name",
			"email",
			"company",
			"team_size",
			"budget",
			"timeline",
			"score",
			"?utm_source",
			"?utm_campaign"
		),
		[
			group("g_start", "Introductions", 0, 0, [
				setVar("s_score", "v_score", "set", "0"),
				text(
					"t_hello",
					"Hi! Let's see how we can help your team. What's your name?"
				),
				textInput("in_name", "v_name", "Your name", { maxLength: 120 }),
				text("t_email", "Thanks {{name}}! What's your work email?"),
				emailInput("in_email", "v_email"),
				text("t_company", "Which company are you with?"),
				textInput("in_company", "v_company", "Company", { maxLength: 160 }),
				jump("j_team", "g_team"),
			]),
			group("g_team", "Team size", 1, 0, [
				text("t_team", "How big is your team?"),
				choice(
					"c_team",
					"v_team_size",
					items(
						["i_t1", "1-10"],
						["i_t2", "11-50"],
						["i_t3", "51-200"],
						["i_t4", "200+"]
					)
				),
				{
					id: "cond_team",
					type: "condition",
					combinator: "or",
					rules: [
						{ variableId: "v_team_size", operator: "equals", value: "51-200" },
						{ variableId: "v_team_size", operator: "equals", value: "200+" },
					],
				},
				jump("j_budget", "g_budget"),
			]),
			bonus("g_team_bonus", 0, "2", "g_budget"),
			group("g_budget", "Budget", 1, 1, [
				text("t_budget", "What's your budget for this project?"),
				choice(
					"c_budget",
					"v_budget",
					items(
						["i_b1", "Under $1k"],
						["i_b2", "$1k-$10k"],
						["i_b3", "Over $10k"]
					)
				),
				{
					id: "cond_budget",
					type: "condition",
					combinator: "and",
					rules: [
						{ variableId: "v_budget", operator: "equals", value: "Over $10k" },
					],
				},
				jump("j_timeline", "g_timeline"),
			]),
			bonus("g_budget_bonus", 1, "2", "g_timeline"),
			group("g_timeline", "Timeline", 1, 2, [
				text("t_timeline", "When are you hoping to start?"),
				choice(
					"c_timeline",
					"v_timeline",
					items(
						["i_now", "This month"],
						["i_quarter", "This quarter"],
						["i_later", "Just exploring"]
					)
				),
				{
					id: "cond_timeline",
					type: "condition",
					combinator: "and",
					rules: [
						{
							variableId: "v_timeline",
							operator: "equals",
							value: "This month",
						},
					],
				},
				jump("j_route", "g_route"),
			]),
			bonus("g_timeline_bonus", 2, "1", "g_route"),
			group("g_route", "Qualify", 3, 0, [
				{
					id: "cond_hot",
					type: "condition",
					combinator: "and",
					rules: [
						{ variableId: "v_score", operator: "greater_than", value: "2" },
					],
				},
				text(
					"t_resources",
					"Thanks! We'll send a few resources that fit where you are today."
				),
				jump("j_handoff_cold", "g_handoff"),
			]),
			group("g_hot", "Book a call", 4, 0, [
				text(
					"t_book",
					"Looks like a great fit. Pick a time that works for you:"
				),
				redirect("r_book", "https://example.com/book-a-call?email={{email}}"),
				jump("j_handoff_hot", "g_handoff"),
			]),
			group("g_handoff", "Hand off to sales", 5, 0, [
				handoff(
					"h_sales",
					"sales",
					"{{name}} <{{email}}> at {{company}}: team {{team_size}}, budget {{budget}}, timeline {{timeline}}, score {{score}} (source {{utm_source}} / {{utm_campaign}})",
					"Thanks {{name}}! Someone from our team will be in touch."
				),
			]),
		],
		edges(
			["cond_team", "g_team_bonus", { branch: "true" }],
			["cond_budget", "g_budget_bonus", { branch: "true" }],
			["cond_timeline", "g_timeline_bonus", { branch: "true" }],
			["cond_hot", "g_hot", { branch: "true" }]
		)
	);
}

function npsSurvey(): Flow {
	const followUp = (id: string, row: number, question: string) =>
		group(id, question, 1, row, [
			text(`${id}_q`, question),
			textInput(`${id}_in`, "v_reason", "Tell us more", { long: true }),
			jump(`${id}_j`, "g_followup"),
		]);
	return flow(
		{ botName: "Feedback", accent: "#059669" },
		vars("nps", "reason", "wants_followup", "email", "?user_id"),
		[
			group("g_start", "Score", 0, 0, [
				text(
					"t_hello",
					"Quick question: how likely are you to recommend us to a friend or colleague?"
				),
				{
					id: "r_nps",
					type: "rating_input",
					saveTo: "v_nps",
					scale: "nps",
					length: 10,
					leftLabel: "Not likely",
					rightLabel: "Very likely",
				},
				{
					id: "cond_detractor",
					type: "condition",
					combinator: "and",
					rules: [{ variableId: "v_nps", operator: "less_than", value: "7" }],
				},
				{
					id: "cond_passive",
					type: "condition",
					combinator: "and",
					rules: [{ variableId: "v_nps", operator: "less_than", value: "9" }],
				},
				jump("j_promoter", "g_promoter"),
			]),
			followUp("g_detractor", 0, "Sorry to hear that. What went wrong?"),
			followUp("g_passive", 1, "Thanks! What would make it a 10?"),
			followUp("g_promoter", 2, "Love to hear it! What do you like most?"),
			group("g_followup", "Follow-up", 2, 0, [
				text("t_followup", "Can we follow up with you by email?"),
				choice(
					"c_followup",
					"v_wants_followup",
					items(["i_no", "No thanks", "no"], ["i_yes", "Yes", "yes"])
				),
			]),
			group("g_email", "Email", 3, 1, [
				text("t_email", "What's the best email to reach you?"),
				emailInput("in_email", "v_email"),
				jump("j_thanks", "g_thanks"),
			]),
			group("g_thanks", "Thanks", 3, 0, [
				text("t_thanks", "Thanks for your feedback. It really helps!"),
			]),
		],
		edges(
			["cond_detractor", "g_detractor", { branch: "true" }],
			["cond_passive", "g_passive", { branch: "true" }],
			["c_followup", "g_thanks", { item: "i_no" }],
			["c_followup", "g_email", { item: "i_yes" }]
		)
	);
}

function appointmentRequest(): Flow {
	return flow(
		{ botName: "Booking assistant", accent: "#0891b2" },
		vars(
			"service",
			"preferred_date",
			"time_slot",
			"name",
			"email",
			"phone",
			"notes",
			"confirm"
		),
		[
			group("g_service", "Service and time", 0, 0, [
				text("t_service", "Which service would you like to book?"),
				choice(
					"c_service",
					"v_service",
					items(
						["i_consult", "Consultation"],
						["i_followup", "Follow-up visit"],
						["i_other", "Something else"]
					)
				),
				text("t_date", "Which day works best for you?"),
				{ id: "in_date", type: "date_input", saveTo: "v_preferred_date" },
				text("t_slot", "And what time of day?"),
				choice(
					"c_slot",
					"v_time_slot",
					items(
						["i_morning", "Morning"],
						["i_afternoon", "Afternoon"],
						["i_evening", "Evening"]
					)
				),
				jump("j_details", "g_details"),
			]),
			group("g_details", "Your details", 1, 0, [
				text("t_name", "What's your name?"),
				textInput("in_name", "v_name", "Your name", { maxLength: 120 }),
				text("t_email", "Your email?"),
				emailInput("in_email", "v_email"),
				text("t_phone", "And a phone number in case we need to reach you?"),
				{
					id: "in_phone",
					type: "phone_input",
					saveTo: "v_phone",
					placeholder: "+1 555 010 0000",
					retryMessage: "Please enter a phone number with 6 to 15 digits.",
				},
				text("t_notes", 'Anything we should know? Reply "none" if not.'),
				textInput("in_notes", "v_notes", "Notes", { long: true }),
				jump("j_summary", "g_summary"),
			]),
			group("g_summary", "Confirm", 2, 0, [
				text(
					"t_summary",
					"Here's your request:\n**Service:** {{service}}\n**When:** {{preferred_date}}, {{time_slot}}\n**Name:** {{name}}\n**Email:** {{email}}\n**Phone:** {{phone}}"
				),
				choice(
					"c_confirm",
					"v_confirm",
					items(["i_confirm", "Confirm"], ["i_edit", "Edit"])
				),
			]),
			group("g_confirmed", "Request sent", 3, 0, [
				handoff(
					"h_appointment",
					"appointment",
					"{{service}} on {{preferred_date}} ({{time_slot}}) for {{name}} <{{email}}>, {{phone}}. Notes: {{notes}}",
					"Thanks {{name}}! We'll confirm your appointment by email shortly."
				),
			]),
		],
		edges(
			["c_confirm", "g_confirmed", { item: "i_confirm" }],
			["c_confirm", "g_service", { item: "i_edit" }]
		)
	);
}

const QUIZ_PRODUCTS = [
	["starter", "Starter"],
	["team", "Team"],
	["pro", "Pro"],
] as const;

function productQuiz(): Flow {
	const questions = [
		{
			id: "q1",
			text: "How many people will use it?",
			answers: ["Just me", "A small team", "A whole company"],
		},
		{
			id: "q2",
			text: "What matters most to you?",
			answers: ["Low cost", "Collaboration", "Advanced controls"],
		},
		{
			id: "q3",
			text: "How soon do you need it?",
			answers: ["Just trying it out", "In the next month", "We need it now"],
		},
	] as const;
	const groups: Group[] = [
		group("g_intro", "Intro", 0, 0, [
			text(
				"t_intro",
				"Answer three quick questions and we'll recommend the right plan."
			),
			...QUIZ_PRODUCTS.map(([product]) =>
				setVar(`s_init_${product}`, `v_score_${product}`, "set", "0")
			),
			jump("j_q1", "g_q1"),
		]),
	];
	const quizEdges: [string, string, { item: string }][] = [];
	questions.forEach((question, index) => {
		const next = questions[index + 1]
			? `g_${questions[index + 1]?.id}`
			: "g_route";
		groups.push(
			group(`g_${question.id}`, `Question ${index + 1}`, 1, index, [
				text(`t_${question.id}`, question.text),
				choice(
					`c_${question.id}`,
					`v_${question.id}`,
					items(
						...question.answers.map((answer, answerIndex): [string, string] => [
							`i_${question.id}_${answerIndex}`,
							answer,
						])
					)
				),
			])
		);
		QUIZ_PRODUCTS.forEach(([product], answerIndex) => {
			const scoreGroup = `g_${question.id}_${product}`;
			groups.push(
				group(scoreGroup, `+1 ${product}`, 2, index * 3 + answerIndex, [
					setVar(
						`s_${question.id}_${product}`,
						`v_score_${product}`,
						"increment",
						"1"
					),
					jump(`j_${question.id}_${product}`, next),
				])
			);
			quizEdges.push([
				`c_${question.id}`,
				scoreGroup,
				{ item: `i_${question.id}_${answerIndex}` },
			]);
		});
	});
	groups.push(
		group("g_route", "Pick a plan", 3, 0, [
			{
				id: "cond_pro",
				type: "condition",
				combinator: "and",
				rules: [
					{
						variableId: "v_score_pro",
						operator: "greater_than",
						value: "{{score_team}}",
					},
					{
						variableId: "v_score_pro",
						operator: "greater_than",
						value: "{{score_starter}}",
					},
				],
			},
			{
				id: "cond_team",
				type: "condition",
				combinator: "and",
				rules: [
					{
						variableId: "v_score_team",
						operator: "greater_than",
						value: "{{score_starter}}",
					},
				],
			},
			jump("j_starter", "g_result_starter"),
		])
	);
	QUIZ_PRODUCTS.forEach(([product, label], index) => {
		groups.push(
			group(`g_result_${product}`, `${label} result`, 4, index, [
				text(
					`t_result_${product}`,
					`We recommend **${label}**. Here's where to learn more:`
				),
				redirect(`r_result_${product}`, `https://example.com/plans/${product}`),
				text(`t_result_${product}_bye`, "Thanks for taking the quiz!"),
			])
		);
	});
	return flow(
		{ botName: "Plan finder", accent: "#db2777" },
		vars("q1", "q2", "q3", "score_starter", "score_team", "score_pro"),
		groups,
		edges(
			...quizEdges,
			["cond_pro", "g_result_pro", { branch: "true" }],
			["cond_team", "g_result_team", { branch: "true" }]
		)
	);
}

function bugReport(): Flow {
	return flow(
		{ botName: "Bug reporter", accent: "#dc2626" },
		vars(
			"area",
			"summary",
			"steps",
			"expected_actual",
			"severity",
			"page_url",
			"email",
			"ref",
			"?app_version",
			"?os"
		),
		[
			group("g_report", "Describe the bug", 0, 0, [
				text("t_hello", "Sorry you hit a bug. Where did it happen?"),
				choice(
					"c_area",
					"v_area",
					items(
						["i_app", "Desktop app"],
						["i_web", "Website"],
						["i_billing", "Billing"],
						["i_other", "Somewhere else"]
					)
				),
				text("t_summary", "Give it a short title."),
				textInput(
					"in_summary",
					"v_summary",
					"e.g. Export button does nothing",
					{ maxLength: 200 }
				),
				text("t_steps", "What steps lead to the bug?"),
				textInput("in_steps", "v_steps", "1. Open… 2. Click…", { long: true }),
				text("t_expected", "What did you expect, and what happened instead?"),
				textInput("in_expected", "v_expected_actual", "Expected… Actually…", {
					long: true,
				}),
				text("t_severity", "How bad is it?"),
				choice(
					"c_severity",
					"v_severity",
					items(
						["i_minor", "Minor"],
						["i_major", "Major"],
						["i_blocker", "Blocks my work"]
					)
				),
			]),
			group("g_submit", "Contact and submit", 1, 0, [
				text("t_url", "Which page were you on? Paste the link."),
				{
					id: "in_url",
					type: "url_input",
					saveTo: "v_page_url",
					placeholder: "https://…",
				},
				text("t_email", "What email should we update?"),
				emailInput("in_email", "v_email"),
				setVar("s_ref", "v_ref", "result_id"),
				handoff(
					"h_bug",
					"bug",
					"[{{severity}}] {{area}}: {{summary}}\nSteps: {{steps}}\nExpected vs actual: {{expected_actual}}\nPage: {{page_url}}\nVersion {{app_version}} on {{os}}\nReporter: {{email}}",
					"Thanks! Your reference is {{ref}}. We'll email {{email}} with updates."
				),
			]),
		],
		edges(["c_severity", "g_submit"])
	);
}

function onboarding(): Flow {
	const tip = (id: string, row: number, lines: string[]) =>
		group(id, "Tip", 1, row, [
			...lines.map((line, index) => text(`${id}_t${index + 1}`, line)),
			jump(`${id}_j`, "g_call"),
		]);
	return flow(
		{ botName: "Onboarding guide", accent: "#ea580c" },
		vars("name", "role", "goal", "wants_call", "email"),
		[
			group("g_start", "Welcome", 0, 0, [
				text("t_hello", "Welcome aboard! What should we call you?"),
				textInput("in_name", "v_name", "Your name", { maxLength: 120 }),
				text("t_role", "Nice to meet you, {{name}}. What's your role?"),
				choice(
					"c_role",
					"v_role",
					items(
						["i_founder", "Founder"],
						["i_engineer", "Engineer"],
						["i_designer", "Designer"],
						["i_other", "Other"]
					)
				),
				text("t_goal", "What do you want to do first?"),
				choice(
					"c_goal",
					"v_goal",
					items(
						["i_automate", "Automate busywork"],
						["i_bot", "Build a bot"],
						["i_data", "Understand my data"]
					)
				),
			]),
			tip("g_tip_automate", 0, [
				"Start with one repetitive task you do every week.",
				"Templates are the fastest way in: pick one close to your task and adjust it.",
			]),
			tip("g_tip_bot", 1, [
				"Bots work best with one clear job. Start from a template and change the wording.",
				"Publish early and read the results tab to see where people drop off.",
			]),
			tip("g_tip_data", 2, [
				"Connect one data source first and ask a simple question about it.",
				"Save the questions you ask often so you can rerun them later.",
			]),
			group("g_call", "Guided setup", 2, 0, [
				text("t_call", "Would you like a guided setup call with our team?"),
				choice(
					"c_call",
					"v_wants_call",
					items(["i_no", "No thanks", "no"], ["i_yes", "Yes please", "yes"])
				),
			]),
			group("g_call_yes", "Book a call", 3, 1, [
				text("t_call_email", "Great! What email should we send the invite to?"),
				emailInput("in_email", "v_email"),
				handoff(
					"h_onboarding",
					"onboarding",
					'{{name}} ({{role}}) wants a setup call about "{{goal}}". Email: {{email}}',
					"Thanks {{name}}! We'll email you a few times to choose from."
				),
			]),
			group("g_docs", "Docs", 3, 0, [
				text("t_docs", "No problem. Here are the docs to get you going:"),
				redirect("r_docs", "https://example.com/docs"),
				text("t_docs_bye", "Have fun, {{name}}!"),
			]),
		],
		edges(
			["c_goal", "g_tip_automate", { item: "i_automate" }],
			["c_goal", "g_tip_bot", { item: "i_bot" }],
			["c_goal", "g_tip_data", { item: "i_data" }],
			["c_call", "g_docs", { item: "i_no" }],
			["c_call", "g_call_yes", { item: "i_yes" }]
		)
	);
}

function contactForm(): Flow {
	return flow(
		{ botName: "Contact", accent: "#4f46e5" },
		vars("name", "email", "topic", "message"),
		[
			group("g_start", "Contact us", 0, 0, [
				text(
					"t_hello",
					"Hi! Leave us a message and we'll get back to you. What's your name?"
				),
				textInput("in_name", "v_name", "Your name", { maxLength: 120 }),
				text("t_email", "Thanks {{name}}. What's your email?"),
				emailInput("in_email", "v_email"),
				text("t_topic", "What's this about?"),
				choice(
					"c_topic",
					"v_topic",
					items(
						["i_sales", "Sales", "sales"],
						["i_support", "Support", "support"],
						["i_partner", "Partnership", "partnership"],
						["i_press", "Press", "press"]
					)
				),
				text("t_message", "What would you like to tell us?"),
				textInput("in_message", "v_message", "Your message", { long: true }),
				handoff(
					"h_contact",
					"{{topic}}",
					"{{name}} <{{email}}>: {{message}}",
					"Thanks {{name}}! We'll get back to you soon."
				),
			]),
		],
		[]
	);
}

function aiFaq(): Flow {
	return flow(
		{ botName: "Help assistant", accent: "#0d9488" },
		vars("question", "answer", "resolved", "email"),
		[
			group("g_start", "Welcome", 0, 0, [
				text(
					"t_hello",
					"Hi! Ask me anything about our product and I'll answer from our help articles."
				),
			]),
			group("g_ask", "Ask", 1, 0, [
				textInput("in_question", "v_question", "Type your question", {
					long: true,
				}),
				{
					id: "ai_answer",
					type: "ai_reply",
					instructions:
						"You answer customer questions using only the knowledge base excerpts provided. Be concise. If the excerpts don't cover the question, say so and offer to connect the customer with a person.",
					promptTemplate: "{{question}}",
					saveTo: "v_answer",
					useKnowledge: true,
					maxChars: 1200,
					fallbackMessage:
						"I couldn't answer that just now. A person can help.",
				},
				text("t_resolved", "Did that answer your question?"),
				choice(
					"c_resolved",
					"v_resolved",
					items(
						["i_yes", "Yes, thanks", "yes"],
						["i_more", "I have another question", "more"],
						["i_human", "Talk to a person", "human"]
					)
				),
			]),
			group("g_more", "Another question", 2, 1, [
				text("t_more", "Sure, what else would you like to know?"),
				jump("j_ask", "g_ask"),
			]),
			group("g_human", "Talk to a person", 2, 2, [
				text("t_human", "No problem. What email should a teammate reply to?"),
				emailInput("in_email", "v_email"),
				handoff(
					"h_faq",
					"support",
					"Question from {{email}}: {{question}}\nAI answer: {{answer}}",
					"Thanks! A teammate will reply to {{email}}."
				),
			]),
			group("g_done", "Resolved", 2, 0, [text("t_done", "Glad I could help!")]),
		],
		edges(
			["t_hello", "g_ask"],
			["c_resolved", "g_done", { item: "i_yes" }],
			["c_resolved", "g_more", { item: "i_more" }],
			["c_resolved", "g_human", { item: "i_human" }]
		)
	);
}

interface TemplateMeta {
	build: () => Flow;
	category: string;
	description: string;
	name: string;
}

const TEMPLATES: Record<BotTemplateId, TemplateMeta> = {
	blank: {
		name: "Blank bot",
		description: "Start from a single welcome message.",
		category: "Basics",
		build: blankFlow,
	},
	"support-triage": {
		name: "Support triage",
		description:
			"Answers common questions by topic, asks for a rating when it helped, and hands unresolved issues to support with an AI-suggested next step.",
		category: "Support",
		build: supportTriage,
	},
	"lead-capture": {
		name: "Lead capture",
		description:
			"Collects contact details, scores team size, budget and timeline, and sends qualified leads to a booking link before handing off to sales.",
		category: "Sales",
		build: leadCapture,
	},
	"nps-survey": {
		name: "NPS survey",
		description:
			"Asks the 0-10 recommendation question, follows up differently for detractors, passives and promoters, and offers an email follow-up.",
		category: "Feedback",
		build: npsSurvey,
	},
	"appointment-request": {
		name: "Appointment request",
		description:
			"Collects the service, preferred day and time, and contact details, shows a summary to confirm or edit, then hands the request off.",
		category: "Intake",
		build: appointmentRequest,
	},
	"product-quiz": {
		name: "Product quiz",
		description:
			"Three questions score each plan, then the bot recommends the best match with a link to learn more.",
		category: "Marketing",
		build: productQuiz,
	},
	"bug-report": {
		name: "Bug report",
		description:
			"Walks reporters through the area, steps, expected and actual behavior, severity and page, then files the report with a reference.",
		category: "Support",
		build: bugReport,
	},
	onboarding: {
		name: "Onboarding",
		description:
			"Learns a new user's name, role and goal, shares tailored tips, and offers a guided setup call or the docs.",
		category: "Customer success",
		build: onboarding,
	},
	"contact-form": {
		name: "Contact form",
		description:
			"A conversational contact form that routes each message by topic.",
		category: "Basics",
		build: contactForm,
	},
	"ai-faq": {
		name: "AI FAQ assistant",
		description:
			"Answers questions from your knowledge articles with AI, lets visitors ask follow-ups, and hands off to a person on request.",
		category: "Support",
		build: aiFaq,
	},
};

/** Returns a fresh copy of a template's flow. */
export function templateFlow(id: BotTemplateId): Flow {
	return TEMPLATES[id].build();
}

export function listTemplates(): BotTemplate[] {
	return (Object.keys(TEMPLATES) as BotTemplateId[]).map((id) => {
		const meta = TEMPLATES[id];
		const built = meta.build();
		return {
			id,
			name: meta.name,
			description: meta.description,
			category: meta.category,
			groupCount: built.groups.length,
			blockCount: blockCount(built),
			flow: built,
		};
	});
}
