// Material 3 breakpoints: https://m3.material.io/foundations/layout/applying-layout/window-size-classes
import defaults from '../../defaults.json' with {type: 'json'};

interface Step {name: string; min: number}

export interface MaterialBreakpoints {
    width: string;
    height: string;
}

/** The step with the largest lower bound (inclusive) the value reaches; the config's step order does not matter. */
function classOf(value: number, steps: Step[]): string {
    return steps.filter(step => value >= step.min).reduce((best, step) => (step.min > best.min ? step : best)).name;
}

export function materialBreakpoints(width: number, height: number): MaterialBreakpoints {
    return {
        width: classOf(width, defaults.breakpoints.width),
        height: classOf(height, defaults.breakpoints.height)
    };
}

/** Flutter's MediaQuery: landscape only when width is greater than height. */
export function orientationOf(width: number, height: number): 'portrait' | 'landscape' {
    return width > height ? 'landscape' : 'portrait';
}

/** The report lines both screen tools print for a frame's size; nothing when the frame has no bounds. */
export function formatBreakpointLines(dimensions: {width: number; height: number} | undefined, prefix = ''): string {
    if (!dimensions) return '';
    const {width, height} = materialBreakpoints(dimensions.width, dimensions.height);
    return `${prefix}Material 3 width breakpoint: ${width} (${Math.round(dimensions.width)} px)\n`
        + `${prefix}Material 3 height breakpoint: ${height} (${Math.round(dimensions.height)} px)\n`
        + `${prefix}Orientation: ${orientationOf(dimensions.width, dimensions.height)}\n`
        + `${prefix}Breakpoints are classified from the frame's size in Figma px.\n`;
}
