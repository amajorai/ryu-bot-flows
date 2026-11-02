import type { ExportTable } from "./contracts.ts";

/**
 * Quotes a CSV cell and neutralizes spreadsheet formulas: a cell that starts
 * with `=`, `+`, `-`, `@`, tab, or carriage return is prefixed with `'`.
 */
export function csvCell(value: string): string {
	const guarded = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
	return `"${guarded.replaceAll('"', '""')}"`;
}

export function toCsv(table: ExportTable): string {
	return `${[table.columns, ...table.rows]
		.map((row) => row.map(csvCell).join(","))
		.join("\r\n")}\r\n`;
}
