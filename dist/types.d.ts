import { Node } from 'unist';
import { RootContent } from 'mdast';

type Quantity = {
    kind: "scalar";
    value: string;
} | {
    kind: "range";
    low: string;
    high: string;
} | {
    kind: "none";
};
type IngredientModifier = "optional" | "hidden" | "reference" | "new" | "recipe" | null;
interface ParsedIngredient {
    name: string;
    alias: string | null;
    quantity: Quantity;
    unit: string | null;
    modifier: IngredientModifier;
    preparation: string | null;
}
interface ParsedCookware {
    name: string;
    quantity: string | null;
}
interface ParsedTimer {
    name: string | null;
    quantity: string;
    unit: string;
}
type ParseMode = "default" | "ingredients" | "steps" | "text";
type DuplicateMode = "new" | "reference";
interface CooklangIngredientNode extends Node {
    type: "cooklangIngredient";
    ingredient: ParsedIngredient;
}
interface CooklangCookwareNode extends Node {
    type: "cooklangCookware";
    cookware: ParsedCookware;
}
interface CooklangTimerNode extends Node {
    type: "cooklangTimer";
    timer: ParsedTimer;
}
interface CooklangTemperatureNode extends Node {
    type: "cooklangTemperature";
    raw: string;
}
declare module "mdast" {
    interface RootContentMap {
        cooklangIngredient: CooklangIngredientNode;
        cooklangCookware: CooklangCookwareNode;
        cooklangTimer: CooklangTimerNode;
        cooklangTemperature: CooklangTemperatureNode;
    }
    interface PhrasingContentMap {
        cooklangIngredient: CooklangIngredientNode;
        cooklangCookware: CooklangCookwareNode;
        cooklangTimer: CooklangTimerNode;
        cooklangTemperature: CooklangTemperatureNode;
    }
}
interface SectionBlock {
    mdastNode: RootContent;
    numbered: boolean;
    mode: ParseMode;
}
interface ParsedSection {
    name: string | null;
    blocks: SectionBlock[];
}
interface CooklangRecipe {
    sections: ParsedSection[];
}
declare module "vfile" {
    interface DataMap {
        cooklang: CooklangRecipe;
    }
}
interface CooklangTransformerOptions {
}

export type { CooklangCookwareNode, CooklangIngredientNode, CooklangRecipe, CooklangTemperatureNode, CooklangTimerNode, CooklangTransformerOptions, DuplicateMode, IngredientModifier, ParseMode, ParsedCookware, ParsedIngredient, ParsedSection, ParsedTimer, Quantity, SectionBlock };
