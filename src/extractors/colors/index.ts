// src/extractors/colors/index.mts

// Core functionality
export { ColorExtractor, extractThemeColors } from './core.js';

// Extractor functions
export {extractColorsFromThemeFrame} from './extractor.js';

// Types
export type {
    ThemeColor,
    ColorDefinition,
    ColorExtractionContext,
    ColorExtractorFn,
    ThemeGenerationOptions
} from './types.js';
