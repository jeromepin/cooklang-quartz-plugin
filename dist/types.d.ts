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
type StepToken = {
    type: "text";
    value: string;
} | {
    type: "ingredient";
    ingredient: ParsedIngredient;
} | {
    type: "cookware";
    cookware: ParsedCookware;
} | {
    type: "timer";
    timer: ParsedTimer;
} | {
    type: "wiki-link";
    target: string;
    display: string | null;
} | {
    type: "temperature";
    raw: string;
};
interface ParsedStep {
    tokens: StepToken[];
    isText: boolean;
}
interface ParsedSection {
    name: string | null;
    steps: ParsedStep[];
}
type ParseMode = "default" | "ingredients" | "steps" | "text";
type DuplicateMode = "new" | "reference";
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

export type { CooklangRecipe, CooklangTransformerOptions, DuplicateMode, IngredientModifier, ParseMode, ParsedCookware, ParsedIngredient, ParsedSection, ParsedStep, ParsedTimer, Quantity, StepToken };
