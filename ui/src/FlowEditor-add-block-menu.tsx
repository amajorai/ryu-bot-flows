import {
	Button,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@ryu/blocks/companion/controls";
import {
	DropdownMenuGroup,
	DropdownMenuLabel,
	DropdownMenuSeparator,
} from "@ryu/ui/components/dropdown-menu.tsx";
import {
	BLOCK_CATEGORIES,
	type BlockType,
} from "../../sidecar/src/contracts.ts";
import type { Copy } from "./copy.ts";
import { BLOCK_LABELS } from "./flow-model.ts";

const CATEGORY_LABELS: Record<keyof typeof BLOCK_CATEGORIES, string> = {
	bubbles: "Bubbles",
	inputs: "Inputs",
	logic: "Logic",
	integrations: "Integrations",
};

/** The grouped "Add block" menu (Bubbles / Inputs / Logic / Integrations). */
export function AddBlockMenu({
	copy,
	disabled,
	label,
	onAdd,
	size = "sm",
	variant = "outline",
}: {
	copy: Copy;
	disabled?: boolean;
	label: string;
	onAdd: (type: BlockType) => void;
	size?: "sm" | "xs";
	variant?: "outline" | "ghost";
}) {
	const categories = Object.keys(
		BLOCK_CATEGORIES
	) as (keyof typeof BLOCK_CATEGORIES)[];
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				disabled={disabled}
				render={<Button className="nodrag" size={size} variant={variant} />}
			>
				{label}
			</DropdownMenuTrigger>
			<DropdownMenuContent
				align="start"
				className="max-h-96 w-56 overflow-y-auto"
			>
				{categories.map((category, index) => (
					<DropdownMenuGroup key={category}>
						{index > 0 ? <DropdownMenuSeparator /> : null}
						<DropdownMenuLabel>
							{copy(`category.${category}`, CATEGORY_LABELS[category])}
						</DropdownMenuLabel>
						{BLOCK_CATEGORIES[category].map((type) => (
							<DropdownMenuItem key={type} onClick={() => onAdd(type)}>
								{BLOCK_LABELS[type]}
							</DropdownMenuItem>
						))}
					</DropdownMenuGroup>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
