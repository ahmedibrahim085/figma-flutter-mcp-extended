// src/extractors/components/index.mts

export {
    extractMetadata,
    extractLayoutInfo,
    extractStylingInfo,
    createNestedComponentInfo,
    createComponentChild,
    isComponentNode,
    determineLayoutType,
    hasPadding,
    extractPadding,
    convertFillToColorInfo,
    convertStrokeInfo,
    categorizeEffects,
    extractCornerRadius,
    extractBasicLayout,
    extractBasicStyling,
    extractTextInfo,
    rgbaToHex
} from './extractor.js';

export {VariantAnalyzer} from './variant-analyzer.js';

// Deduplicated extractor
export {
    DeduplicatedComponentExtractor,
    type DeduplicatedComponentAnalysis,
    type DeduplicatedComponentChild
} from './deduplicated-extractor.js';

// Types
export type {
    ComponentAnalysis,
    ComponentMetadata,
    LayoutInfo,
    StylingInfo,
    ComponentChild,
    NestedComponentInfo,
    ComponentVariant,
    CategorizedEffects,
    DropShadowEffect,
    InnerShadowEffect,
    BlurEffect,
    ColorInfo,
    StrokeInfo,
    CornerRadii,
    PaddingInfo,
    TextInfo
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