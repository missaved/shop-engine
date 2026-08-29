// LLM 抽象层统一出口（第 19 批 A2）
export type { LLMProvider, LLMProviderName, ChatMessage, ChatOptions } from './provider'
export { deepseek } from './deepseek'
export { minimax } from './minimax'
export { gemini } from './gemini'
export { generateStructuredJSON, extractJSON } from './generate'
export type { GenerateStructuredOptions, GenerateStructuredResult } from './generate'
export {
  DishItemSchema,
  DishOptionGroupSchema,
  DishBatchSchema,
  DIETARY_TAGS,
  FOOD_SUBCATEGORIES,
  buildDishSystemPrompt,
  buildDishUserPrompt,
  buildImagePrompt,
} from './prompts'
export type { DishItem, DishBatch, Cuisine, SubcategoryMeta, OptionGroupTemplate } from './prompts'
