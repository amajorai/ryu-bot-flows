/**
 * `{{varName}}` templating shared by the engine and the Companion UI.
 *
 * Pure TypeScript with no Bun or DOM APIs. Templates only substitute variable
 * values: there are no expressions, filters, or code paths.
 */

const TEMPLATE_TOKEN = /\{\{\s*([A-Za-z_][A-Za-z0-9_]{0,63})\s*\}\}/g;

/** How a substituted value is escaped for the place the template lands. */
export type TemplateEscape = "none" | "url" | "json";

export type TemplateLookup = (name: string) => string | undefined;

function escapeValue(value: string, escaping: TemplateEscape): string {
	if (escaping === "url") {
		return encodeURIComponent(value);
	}
	if (escaping === "json") {
		// The value lands inside an existing JSON string literal.
		return JSON.stringify(value).slice(1, -1);
	}
	return value;
}

/** Replaces each `{{name}}` with the variable value, or an empty string. */
export function renderTemplate(
	template: string,
	lookup: TemplateLookup,
	escaping: TemplateEscape = "none"
): string {
	return template.replace(TEMPLATE_TOKEN, (_match, name: string) =>
		escapeValue(lookup(name) ?? "", escaping)
	);
}

/** Lists the distinct variable names a template references, in order. */
export function templateVariableNames(template: string): string[] {
	const names: string[] = [];
	for (const match of template.matchAll(TEMPLATE_TOKEN)) {
		const name = match[1];
		if (name && !names.includes(name)) {
			names.push(name);
		}
	}
	return names;
}
