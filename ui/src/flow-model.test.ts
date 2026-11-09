import { describe, expect, test } from "bun:test";
import {
	BLOCK_CATEGORIES,
	type BlockType,
	DEFAULT_SETTINGS,
	DEFAULT_THEME,
	type Flow,
	flowErrors,
	flowSchema,
} from "../../sidecar/src/contracts.ts";
import { listTemplates } from "../../sidecar/src/templates.ts";
import {
	addBlock,
	addGroup,
	addVariable,
	blockHandles,
	blockSummary,
	connect,
	deleteBlock,
	deleteGroup,
	deleteVariable,
	edgeFrom,
	findBlock,
	handleId,
	type IdFactory,
	indexIssues,
	jumpsTo,
	moveBlock,
	moveBlockToGroup,
	moveGroup,
	parseHandleId,
	plainText,
	randomId,
	removeEdge,
	renameGroup,
	renameVariable,
	resolveOverlaps,
	setStartGroup,
	uniqueVariableName,
	updateBlock,
	updateVariable,
	variableUsage,
} from "./flow-model.ts";

function sequentialIds(): IdFactory {
	let next = 0;
	return (prefix) => {
		next++;
		return `${prefix}_${next}`;
	};
}

function blankFlow(): Flow {
	return {
		version: 1,
		variables: [],
		groups: [
			{
				id: "start",
				title: "Start",
				position: { x: 0, y: 0 },
				blocks: [{ id: "hello", type: "text", content: "Hi!" }],
			},
		],
		edges: [],
		startGroupId: "start",
		theme: DEFAULT_THEME,
		settings: DEFAULT_SETTINGS,
	};
}

describe("handle ids", () => {
	test("round-trip plain, item, and branch sources", () => {
		for (const source of [
			{ blockId: "b_1" },
			{ blockId: "b_1", itemId: "i-2" },
			{ blockId: "b_1", branch: "false" as const },
		]) {
			expect(parseHandleId(handleId(source))).toEqual(source);
		}
	});

	test("reject unknown shapes", () => {
		expect(parseHandleId("in")).toBeNull();
		expect(parseHandleId("out:b:branch:maybe")).toBeNull();
		expect(parseHandleId("out:b:item:")).toBeNull();
		expect(parseHandleId(null)).toBeNull();
	});

	test("random ids match the contract pattern", () => {
		expect(randomId("b")).toMatch(/^b_[A-Za-z0-9]{10}$/);
	});
});

describe("blockHandles", () => {
	test("single choice exposes each item plus a default branch", () => {
		const handles = blockHandles({
			id: "c",
			type: "choice_input",
			items: [
				{ id: "y", label: "Yes" },
				{ id: "n", label: "No" },
			],
		});
		expect(handles.map((handle) => handleId(handle.source))).toEqual([
			"out:c:item:y",
			"out:c:item:n",
			"out:c:branch:default",
		]);
	});

	test("multiple choice, condition, A/B and jump", () => {
		expect(
			blockHandles({
				id: "c",
				type: "choice_input",
				multiple: true,
				items: [{ id: "y", label: "Yes" }],
			})
		).toEqual([{ label: null, source: { blockId: "c" } }]);
		expect(
			blockHandles({
				id: "k",
				type: "condition",
				combinator: "and",
				rules: [{ variableId: "v", operator: "is_set" }],
			}).map((handle) => handle.source.branch)
		).toEqual(["true", "false"]);
		expect(
			blockHandles({ id: "ab", type: "ab_test", percentA: 30 }).map(
				(handle) => handle.label
			)
		).toEqual(["A · 30%", "B · 70%"]);
		expect(blockHandles({ id: "j", type: "jump", groupId: "start" })).toEqual(
			[]
		);
	});
});

describe("groups", () => {
	test("add, rename, move, make start, delete", () => {
		const ids = sequentialIds();
		const added = addGroup(blankFlow(), { x: 340, y: 0 }, "Next", ids);
		expect(added.groupId).toBe("g_1");
		let flow = renameGroup(added.flow, "g_1", "Follow-up");
		flow = moveGroup(flow, "g_1", { x: 400.6, y: -10.2 });
		const group = flow.groups.find((item) => item.id === "g_1");
		expect(group?.title).toBe("Follow-up");
		expect(group?.position).toEqual({ x: 401, y: -10 });

		flow = connect(flow, { blockId: "hello" }, "g_1", ids);
		expect(flow.edges).toHaveLength(1);
		expect(deleteGroup(flow, "start")).toBe(flow);

		flow = setStartGroup(flow, "g_1");
		expect(flow.startGroupId).toBe("g_1");
		const removed = deleteGroup(setStartGroup(flow, "start"), "g_1");
		expect(removed.groups.map((item) => item.id)).toEqual(["start"]);
		expect(removed.edges).toEqual([]);
	});

	test("never mutates its input", () => {
		const flow = blankFlow();
		const snapshot = JSON.stringify(flow);
		addGroup(flow, { x: 1, y: 1 }, "x");
		addBlock(flow, "start", "email_input");
		renameGroup(flow, "start", "Renamed");
		expect(JSON.stringify(flow)).toBe(snapshot);
	});
});

describe("blocks", () => {
	test("every block type can be added and the result parses", () => {
		const types = Object.values(BLOCK_CATEGORIES).flat() as BlockType[];
		let flow = blankFlow();
		const ids = sequentialIds();
		for (const type of types) {
			const result = addBlock(flow, "start", type, ids);
			expect(result.blockId).not.toBe("");
			flow = result.flow;
		}
		expect(flowSchema.safeParse(flow).success).toBe(true);
		expect(flow.groups[0]?.blocks).toHaveLength(types.length + 1);
	});

	test("inputs get a fresh saveTo variable", () => {
		const result = addBlock(
			blankFlow(),
			"start",
			"email_input",
			sequentialIds()
		);
		const block = findBlock(result.flow, result.blockId)?.block;
		expect(block?.type).toBe("email_input");
		expect(result.flow.variables).toEqual([{ id: "v_2", name: "email" }]);
		expect(block && "saveTo" in block ? block.saveTo : undefined).toBe("v_2");
	});

	test("removing a choice item drops its edge; switching to multiple drops item edges", () => {
		const ids = sequentialIds();
		let flow = addGroup(blankFlow(), { x: 300, y: 0 }, "Yes", ids).flow;
		const added = addBlock(flow, "start", "choice_input", ids);
		flow = added.flow;
		const located = findBlock(flow, added.blockId);
		if (located?.block.type !== "choice_input") {
			throw new Error("expected a choice block");
		}
		const [yes, no] = located.block.items;
		if (!(yes && no)) {
			throw new Error("expected two items");
		}
		flow = connect(
			flow,
			{ blockId: added.blockId, itemId: yes.id },
			"g_1",
			ids
		);
		flow = connect(flow, { blockId: added.blockId, itemId: no.id }, "g_1", ids);
		flow = connect(
			flow,
			{ blockId: added.blockId, branch: "default" },
			"start",
			ids
		);
		expect(flow.edges).toHaveLength(3);

		const withoutNo = updateBlock(flow, {
			...located.block,
			items: [yes],
		});
		expect(withoutNo.edges).toHaveLength(2);
		expect(
			edgeFrom(withoutNo, { blockId: added.blockId, itemId: no.id })
		).toBeUndefined();

		const multiple = updateBlock(flow, { ...located.block, multiple: true });
		expect(multiple.edges).toEqual([]);
	});

	test("connect replaces the edge on the same handle and rejects bad handles", () => {
		const ids = sequentialIds();
		let flow = addGroup(blankFlow(), { x: 300, y: 0 }, "A", ids).flow;
		flow = addGroup(flow, { x: 600, y: 0 }, "B", ids).flow;
		flow = connect(flow, { blockId: "hello" }, "g_1", ids);
		flow = connect(flow, { blockId: "hello" }, "g_2", ids);
		expect(flow.edges.map((edge) => edge.to.groupId)).toEqual(["g_2"]);
		expect(
			connect(flow, { blockId: "hello", branch: "true" }, "g_1", ids)
		).toBe(flow);
		expect(connect(flow, { blockId: "missing" }, "g_1", ids)).toBe(flow);
		expect(connect(flow, { blockId: "hello" }, "nowhere", ids)).toBe(flow);
		const edgeId = flow.edges[0]?.id ?? "";
		expect(removeEdge(flow, edgeId).edges).toEqual([]);
	});

	test("move within and between groups; delete removes edges", () => {
		const ids = sequentialIds();
		let flow = addBlock(blankFlow(), "start", "text", ids).flow;
		const second = flow.groups[0]?.blocks[1]?.id ?? "";
		flow = moveBlock(flow, second, -1);
		expect(flow.groups[0]?.blocks.map((block) => block.id)).toEqual([
			second,
			"hello",
		]);
		expect(moveBlock(flow, second, -1).groups[0]?.blocks[0]?.id).toBe(second);

		const other = addGroup(flow, { x: 300, y: 0 }, "Other", ids);
		flow = connect(other.flow, { blockId: "hello" }, "start", ids);
		flow = moveBlockToGroup(flow, "hello", other.groupId);
		expect(findBlock(flow, "hello")?.group.id).toBe(other.groupId);
		expect(flow.edges).toHaveLength(1);
		flow = deleteBlock(flow, "hello");
		expect(findBlock(flow, "hello")).toBeNull();
		expect(flow.edges).toEqual([]);
	});
});

describe("variables", () => {
	test("unique, valid names", () => {
		let flow = blankFlow();
		flow = addVariable(flow, "email", sequentialIds()).flow;
		expect(uniqueVariableName(flow, "email")).toBe("email_2");
		expect(uniqueVariableName(flow, "1st name!")).toBe("st_name");
		expect(uniqueVariableName(flow, "!!!")).toBe("variable");
	});

	test("usage counting, prefill flag, and deletion surfaces validation errors", () => {
		const ids = sequentialIds();
		let flow = addBlock(blankFlow(), "start", "email_input", ids).flow;
		const variableId = flow.variables[0]?.id ?? "";
		flow = updateBlock(flow, {
			id: "hello",
			type: "text",
			content: "Thanks {{email}}",
		});
		expect(variableUsage(flow, variableId)).toBe(2);

		flow = updateVariable(flow, variableId, { hidden: true });
		expect(flow.variables[0]?.hidden).toBe(true);
		flow = updateVariable(flow, variableId, { hidden: false });
		expect("hidden" in (flow.variables[0] ?? {})).toBe(false);

		const removed = deleteVariable(flow, variableId);
		const issues = indexIssues(removed);
		expect(issues.errors).toBeGreaterThan(0);
		expect(
			issues.all.some((issue) => issue.message.includes("{{email}}"))
		).toBe(true);
	});
});

describe("validation index and summaries", () => {
	test("indexes edge, block and group issues", () => {
		const flow: Flow = {
			...blankFlow(),
			groups: [
				...blankFlow().groups,
				{
					id: "orphan",
					title: "Orphan",
					position: { x: 300, y: 0 },
					blocks: [],
				},
			],
			edges: [
				{ id: "dangling", from: { blockId: "hello" }, to: { groupId: "gone" } },
			],
		};
		const issues = indexIssues(flow);
		expect(issues.byEdge.get("dangling")?.[0]?.severity).toBe("error");
		expect(issues.byBlock.has("hello")).toBe(true);
		expect(issues.byGroup.get("orphan")?.length).toBeGreaterThan(0);
		expect(issues.errors).toBe(1);
	});

	test("every template is valid and summarizes every block", () => {
		for (const template of listTemplates()) {
			expect(flowErrors(template.flow)).toEqual([]);
			for (const group of template.flow.groups) {
				for (const block of group.blocks) {
					expect(blockSummary(template.flow, block).length).toBeGreaterThan(0);
				}
			}
		}
	});
});

describe("display layout", () => {
	test("pushes overlapping groups in a column down, leaves others alone", () => {
		const offsets = resolveOverlaps([
			{ id: "a", x: 0, y: 0, width: 288, height: 400 },
			{ id: "b", x: 0, y: 260, width: 288, height: 200 },
			{ id: "c", x: 360, y: 260, width: 288, height: 100 },
			{ id: "d", x: 0, y: 520, width: 288, height: 100 },
		]);
		expect(offsets.get("a")).toBe(0);
		expect(offsets.get("b")).toBe(424);
		expect(offsets.get("c")).toBe(260);
		expect(offsets.get("d")).toBe(648);
	});

	test("a dragged group keeps its place and pushes the others", () => {
		const offsets = resolveOverlaps([
			{ id: "a", x: 0, y: 0, width: 288, height: 100 },
			{ id: "b", x: 10, y: 50, width: 288, height: 100, pinned: true },
		]);
		expect(offsets.get("b")).toBe(50);
		expect(offsets.get("a")).toBe(174);
	});

	test("summaries drop markdown markers", () => {
		expect(
			plainText("Open **Settings** and *Billing* or [docs](https://x.example)")
		).toBe("Open Settings and Billing or docs");
	});
});

function templateFlow(id: string): Flow {
	const template = listTemplates().find((candidate) => candidate.id === id);
	if (!template) {
		throw new Error(`missing template ${id}`);
	}
	return template.flow;
}

describe("review regressions", () => {
	test("deleting a group also removes the Jump blocks that pointed at it", () => {
		const flow = templateFlow("support-triage");
		const jumps = jumpsTo(flow, "g_helped");
		expect(jumps.length).toBeGreaterThan(0);
		const next = deleteGroup(flow, "g_helped");
		expect(jumpsTo(next, "g_helped")).toEqual([]);
		for (const jump of jumps) {
			expect(findBlock(next, jump.id)).toBeNull();
		}
		expect(
			flowErrors(next).filter((issue) => issue.message.includes("jump"))
		).toEqual([]);
		expect(flowSchema.safeParse(next).success).toBe(true);
	});

	test("renaming a variable rewrites every {{oldName}} template", () => {
		const flow = templateFlow("lead-capture");
		const variable = flow.variables.find((entry) => entry.name === "name");
		expect(variable).toBeDefined();
		const id = variable?.id ?? "";
		const before = variableUsage(flow, id);
		const next = renameVariable(flow, id, "first_name");
		const serialized = JSON.stringify(next.groups);
		expect(serialized).not.toMatch(/\{\{\s*name\s*\}\}/);
		expect(serialized).toContain("{{first_name}}");
		expect(variableUsage(next, id)).toBe(before);
		expect(
			indexIssues(next).all.filter((issue) => issue.message.includes("{{"))
		).toEqual(
			indexIssues(flow).all.filter((issue) => issue.message.includes("{{"))
		);
		// Invalid or taken names leave the flow untouched.
		expect(renameVariable(flow, id, "1bad")).toBe(flow);
		expect(renameVariable(flow, id, "email")).toBe(flow);
	});

	test("renaming does not touch tokens for other variables that share a prefix", () => {
		const ids = sequentialIds();
		const base = addVariable(blankFlow(), "name", ids);
		const withOther = addVariable(base.flow, "name_full", ids);
		const flow = updateBlock(withOther.flow, {
			id: "hello",
			type: "text",
			content: "Hi {{ name }} / {{name_full}}",
		});
		const next = renameVariable(flow, base.variableId, "who");
		expect(findBlock(next, "hello")?.block).toEqual({
			id: "hello",
			type: "text",
			content: "Hi {{who}} / {{name_full}}",
		});
	});
});
