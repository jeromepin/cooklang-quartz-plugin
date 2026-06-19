import { QuartzTransformerPlugin } from '@quartz-community/types';
export { BuildCtx, QuartzTransformerPlugin, QuartzTransformerPluginInstance, StaticResources } from '@quartz-community/types';
import { CooklangTransformerOptions, CooklangRecipe } from './types.js';
export { DuplicateMode, IngredientModifier, ParseMode, ParsedCookware, ParsedIngredient, ParsedSection, ParsedStep, ParsedTimer, Quantity, StepToken } from './types.js';

declare const CooklangTransformer: QuartzTransformerPlugin<Partial<CooklangTransformerOptions>>;

declare function parseCooklang(rawSrc: string): CooklangRecipe;

export { CooklangRecipe, CooklangTransformer, CooklangTransformerOptions, parseCooklang, CooklangTransformer as transformer };
