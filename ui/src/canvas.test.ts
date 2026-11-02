import { describe, expect, test } from "bun:test";
import { explicitDeletions, inspectorFitPadding } from "./canvas.ts";

describe("canvas delete policy", () => {
	test("Delete on a selected group removes neither it nor its connections", () => {
		// React Flow hands onBeforeDelete the selected node plus every edge
		// connected to it; only explicitly selected edges may go.
		const result = explicitDeletions({
			nodes: [{ id: "g_welcome" }],
			edges: [
				{ id: "e_1", selected: false },
				{ id: "e_2" },
				{ id: "e_3", selected: true },
			],
		});
		expect(result).toEqual({
			nodes: [],
			edges: [{ id: "e_3", selected: true }],
		});
	});
});

describe("inspector-aware focus", () => {
	test("wide canvases keep the plain padding", () => {
		expect(inspectorFitPadding(1280, true)).toBe(0.2);
		expect(inspectorFitPadding(800, false)).toBe(0.2);
	});

	test("medium widths reserve the overlaid inspector on the right", () => {
		expect(inspectorFitPadding(800, true)).toEqual({
			top: "10%",
			bottom: "10%",
			left: "5%",
			right: "408px",
		});
	});

	test("narrow widths keep the group above the bottom sheet", () => {
		expect(inspectorFitPadding(390, true)).toEqual({
			top: "5%",
			bottom: "62%",
			x: "5%",
		});
	});
});
