import { QuartzTransformerPlugin } from '@quartz-community/types';
export { BuildCtx, QuartzTransformerPlugin, QuartzTransformerPluginInstance, StaticResources } from '@quartz-community/types';
import { CooklangTransformerOptions } from './types.js';
export { CooklangCookwareNode, CooklangIngredientNode, CooklangRecipe, CooklangTemperatureNode, CooklangTimerNode, DuplicateMode, IngredientModifier, ParseMode, ParsedCookware, ParsedIngredient, ParsedSection, ParsedTimer, Quantity, SectionBlock } from './types.js';
import 'unist';
import 'mdast';

declare const CooklangTransformer: QuartzTransformerPlugin<Partial<CooklangTransformerOptions>>;

export { CooklangTransformer, CooklangTransformerOptions, CooklangTransformer as transformer };
