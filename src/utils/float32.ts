/**
 * Figma sends float32 values as doubles (0.4 arrives as 0.4000000059604645). Returns the shortest
 * decimal that reads back as the same float32.
 */
export function shortestFloat32(value: number): number {
    for (let precision = 1; precision <= 9; precision++) {
        const candidate = Number(value.toPrecision(precision));
        if (Math.fround(candidate) === Math.fround(value)) return candidate;
    }
    return value;
}
