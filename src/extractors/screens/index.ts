// src/extractors/screens/index.mts

// Core functionality
export {
    ScreenExtractor,
    analyzeScreen
} from './core.js';

export {
    extractScreenMetadata,
    extractScreenLayoutInfo,
    analyzeScreenSections,
    extractNavigationInfo
} from './extractor.js';

// Types
export type {
    ScreenAnalysis,
    ScreenMetadata,
    ScreenLayoutInfo,
    ScreenSection,
    NavigationInfo,
    NavigationElement,
    SkippedNodeInfo,
    ScreenExtractionOptions
} from './types.js';

// Convenience functions
export {
    parseComponentInput,
    isValidNodeIdFormat,
    extractIds,
    generateFigmaUrl,
    isFigmaUrl
} from '../../utils/figma-url-parser.js';

// Re-export commonly used types from figma types
export type {FigmaNode, FigmaColor, FigmaEffect} from '../../types/figma.js';
