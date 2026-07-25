export {
  buildPromptAugmentation,
  renderToolSchemas,
} from './augmentation';

export {
  VISIBLE_USER_PROMPT_END,
  VISIBLE_USER_PROMPT_START,
  containsInternalPromptMarker,
  extractVisibleUserPrompt,
  markVisibleUserPrompt,
  sanitizeInternalPromptText,
} from './visibility';

export type {
  PromptAugmentationOptions,
  PromptAugmentationResult,
  PromptStagePieces,
} from './augmentation';
