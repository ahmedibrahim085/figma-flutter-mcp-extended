// src/types/figma.mts

export interface FigmaFile {
    document: FigmaNode;
    components: {[key: string]: FigmaComponent};
    styles: {[key: string]: FigmaStyle};
    name: string;
    lastModified: string;
    version: string;
    role: string;
    editorType: string;
}

/** A Figma REST Action. Only the fields the reports print are typed. */
export interface FigmaAction {
    type: string;
    url?: string;
    destinationId?: string | null;
    navigation?: string;
}

/** A Figma REST Interaction: a prototype trigger and the actions it runs. */
export interface FigmaInteraction {
    trigger: {type: string} | null;
    actions?: FigmaAction[];
}

export interface FigmaNode {
    id: string;
    name: string;
    type: string;
    visible?: boolean;
    children?: FigmaNode[];
    fills?: FigmaFill[];
    strokes?: FigmaStroke[];
    effects?: FigmaEffect[];
    backgroundColor?: FigmaColor;
    style?: FigmaTextStyle;
    constraints?: FigmaConstraints;
    layoutPositioning?: 'AUTO' | 'ABSOLUTE';
    clipsContent?: boolean;
    interactions?: FigmaInteraction[];
    rotation?: number;
    itemReverseZIndex?: boolean;
    minWidth?: number | null;
    maxWidth?: number | null;
    minHeight?: number | null;
    maxHeight?: number | null;
    absoluteBoundingBox?: FigmaBoundingBox;
    layoutMode?: string;
    primaryAxisSizingMode?: string;
    counterAxisSizingMode?: string;
    layoutSizingHorizontal?: 'FIXED' | 'HUG' | 'FILL';
    layoutSizingVertical?: 'FIXED' | 'HUG' | 'FILL';
    layoutAlign?: 'INHERIT' | 'STRETCH';
    primaryAxisAlignItems?: string;
    counterAxisAlignItems?: string;
    layoutGrow?: number;
    paddingLeft?: number;
    paddingRight?: number;
    paddingTop?: number;
    paddingBottom?: number;
    itemSpacing?: number;
    /** Stroke weight lives on the node in Figma REST, not on each stroke paint. */
    strokeWeight?: number;
    /** Stroke alignment on the node: INSIDE | OUTSIDE | CENTER */
    strokeAlign?: string;
    cornerRadius?: number;
    rectangleCornerRadii?: number[];
    // Text-specific properties
    characters?: string; // Actual text content for TEXT nodes
    characterStyleOverrides?: number[];
    styleOverrideTable?: {[key: string]: FigmaTextStyle};
}

export interface FigmaComponent {
    key: string;
    file_key: string;
    node_id: string;
    thumbnail_url: string;
    name: string;
    description: string;
    created_at: string;
    updated_at: string;
    user: {
        id: string;
        handle: string;
        img_url: string;
    };
    containing_frame?: {
        name: string;
        node_id: string;
    };
}

export interface FigmaComponentSet {
    key: string;
    file_key: string;
    node_id: string;
    thumbnail_url: string;
    name: string;
    description: string;
    created_at: string;
    updated_at: string;
    user: {
        id: string;
        handle: string;
        img_url: string;
    };
    containing_frame?: {
        name: string;
        node_id: string;
    };
}

export interface FigmaStyle {
    key: string;
    file_key: string;
    node_id: string;
    style_type: 'FILL' | 'TEXT' | 'EFFECT' | 'GRID';
    thumbnail_url: string;
    name: string;
    description: string;
    created_at: string;
    updated_at: string;
    user: {
        id: string;
        handle: string;
        img_url: string;
    };
    sort_position: string;
}

export interface FigmaColor {
    r: number;
    g: number;
    b: number;
    a: number;
}

export interface FigmaFill {
    type: string;
    color?: FigmaColor;
    gradientStops?: Array<{
        color: FigmaColor;
        position: number;
    }>;
    visible?: boolean;
    /** Paint opacity, 0-1 (Figma REST Paint.opacity; absent means 1). */
    opacity?: number;
}

export interface FigmaStroke {
    type: string;
    color: FigmaColor;
    strokeWeight?: number;
    visible?: boolean;
}

export interface FigmaEffect {
    type: string;
    color?: FigmaColor;
    offset?: {x: number; y: number};
    radius: number;
    spread?: number;
    visible?: boolean;
}

export interface FigmaTextStyle {
    fontFamily: string;
    fontWeight: number;
    fontSize: number;
    letterSpacing: number;
    lineHeightPx: number;
    textAlignHorizontal: string;
    textAlignVertical: string;
    italic?: boolean;
    /** PIXELS, FONT_SIZE_% or INTRINSIC_% (Figma's Auto). */
    lineHeightUnit?: string;
    lineHeightPercentFontSize?: number;
    /** NONE, UNDERLINE or STRIKETHROUGH. */
    textDecoration?: string;
    /** ORIGINAL, UPPER, LOWER, TITLE, SMALL_CAPS or SMALL_CAPS_FORCED. */
    textCase?: string;
    /** DISABLED or ENDING; maxLines applies only with ENDING. */
    textTruncation?: string;
    maxLines?: number;
    /** NONE, HEIGHT, WIDTH_AND_HEIGHT or TRUNCATE. */
    textAutoResize?: string;
    /** Space between paragraphs, px. */
    paragraphSpacing?: number;
    paragraphIndent?: number;
    listSpacing?: number;
    /** NONE or CAP_HEIGHT (Figma's vertical trim). */
    leadingTrim?: string;
}

export interface FigmaConstraints {
    vertical: string;
    horizontal: string;
}

export interface FigmaBoundingBox {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface FigmaPageInfo {
    id: string;
    name: string;
    type: string;
}

export interface FigmaFileInfo {
    name: string;
    lastModified: string;
    version: string;
    role: string;
    editorType: string;
    componentCount: number;
    styleCount: number;
    pageCount: number;
}

// Image Export Types
export interface ImageExportOptions {
    format?: 'png' | 'jpg' | 'svg' | 'pdf';
    scale?: number; // 1, 2, 3, 4 for PNG/JPG
    svgIncludeId?: boolean;
    svgSimplifyStroke?: boolean;
    svgOutlineText?: boolean;
    useAbsoluteBounds?: boolean;
    version?: string;
}

export interface ImageExportResponse {
    err?: string;
    images: {[nodeId: string]: string | null};
}

export interface ImageFillsResponse {
    err?: string;
    meta: {
        images: {[imageRef: string]: string};
    };
}

// Responses
export interface ComponentResponse {
    meta: {
        components: FigmaComponent[];
    };
}

export interface ComponentSetResponse {
    meta: {
        component_sets: FigmaComponentSet[];
    };
}

export interface StylesResponse {
    meta: {
        styles: FigmaStyle[];
    };
}

// Single Node Response
export interface NodeResponse {
    nodes: {
        [nodeId: string]: {
            document: FigmaNode;
            components?: {[key: string]: FigmaComponent};
            styles?: {[key: string]: FigmaStyle};
        };
    };
}

// Page Response  
export interface PageResponse {
    document: FigmaNode;
    components?: {[key: string]: FigmaComponent};
    styles?: {[key: string]: FigmaStyle};
}