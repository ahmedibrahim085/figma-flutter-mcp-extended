import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, existsSync} from 'node:fs';
import {rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {callToolOffline, nodeRoute, FILE_KEY} from './helpers/offline-tool.ts';

// Theme colours from styles (ticket 09). Expected values are written here, not read from the code.
const box = (width: number, height: number) => ({x: 0, y: 0, width, height});
const solid = (r: number, g: number, b: number, a = 1, opacity?: number) =>
    ({type: 'SOLID', color: {r, g, b, a}, ...(opacity === undefined ? {} : {opacity})});
const rect = (id: string, name: string, fill: object, extra: object = {}) =>
    ({id, name, type: 'RECTANGLE', fills: [fill], absoluteBoundingBox: box(40, 40), ...extra});
const palette = (...children: object[]) => ({id: '90:1', name: 'Palette', type: 'FRAME', children});

/** Runs extract_theme_colors into a temp project; returns the report and the generated files. */
async function extract(
    t: {after: (fn: () => Promise<void>) => void},
    frame: {id: string},
    opts: {styles?: Record<string, {name: string; styleType: string}>; generateThemeData?: boolean; extraRoutes?: Record<string, any>} = {},
) {
    const dir = mkdtempSync(join(tmpdir(), 'theme-colours-'));
    t.after(() => rm(dir, {recursive: true, force: true}));
    const result = await callToolOffline(
        {...nodeRoute(frame.id, frame, opts.styles), ...opts.extraRoutes},
        'extract_theme_colors',
        {fileId: FILE_KEY, nodeId: frame.id, projectPath: dir, generateThemeData: opts.generateThemeData ?? false},
    );
    const file = (name: string) => {
        const path = join(dir, 'lib', 'theme', name);
        return existsSync(path) ? readFileSync(path, 'utf-8') : undefined;
    };
    return {report: result.text, colors: file('app_colors.dart'), theme: file('app_theme.dart')};
}

test('swatches named "Surface Large" and "Brand" are kept', async (t) => {
    const {report, colors} = await extract(t, palette(
        {id: '90:2', name: 'Surface Large', type: 'FRAME', fills: [solid(1, 1, 1)], absoluteBoundingBox: box(80, 80), children: [
            {id: '90:3', name: 'label', type: 'TEXT', characters: 'Surface Large', absoluteBoundingBox: box(40, 10)},
        ]},
        {id: '90:4', name: 'Brand', type: 'FRAME', absoluteBoundingBox: box(80, 80), children: [rect('90:5', 'Rectangle 1', solid(1, 0, 0))]},
    ));

    assert.match(report, /Colors found: 2/);
    assert.match(colors!, /static const Color surfaceLarge = Color\(0xFFFFFFFF\);/);
    assert.match(colors!, /static const Color brand = Color\(0xFFFF0000\);/);
});

test('a 50% swatch gives an 0x80 colour, whether alpha is in the colour or the paint opacity', async (t) => {
    const {colors} = await extract(t, palette(
        rect('90:2', 'viaOpacity', solid(1, 0, 0, 1, 0.5)),
        rect('90:3', 'viaAlpha', solid(0, 0, 1, 0.5)),
    ));

    assert.match(colors!, /static const Color viaOpacity = Color\(0x80FF0000\);/);
    assert.match(colors!, /static const Color viaAlpha = Color\(0x800000FF\);/);
});

test('no colour named primary gives no ColorScheme, a note, and a theme that needs no AppColors', async (t) => {
    const {report, theme} = await extract(t, palette(rect('90:2', 'Accent', solid(1, 0, 0))), {generateThemeData: true});

    assert.doesNotMatch(theme!, /ColorScheme|AppColors|app_colors/);
    assert.match(theme!, /ThemeData\(\s*useMaterial3: true,?\s*\)/);
    assert.match(report, /No color named primary: no ColorScheme was generated/);
});

test('the fill style name wins over the layer name', async (t) => {
    const {colors} = await extract(t, palette(
        rect('90:2', 'Rectangle 1', solid(1, 0, 0), {styles: {fill: 'S:1'}}),
    ), {styles: {'S:1': {name: 'Brand/Primary', styleType: 'FILL'}}});

    assert.match(colors!, /static const Color primary = Color\(0xFFFF0000\);/);
    assert.doesNotMatch(colors!, /rectangle1/);
});

test('a name keeps its last segment, unless two names share it: then each uses its full path', async (t) => {
    const {colors} = await extract(t, palette(
        rect('90:2', 'Light/Surface', solid(1, 1, 1)),
        rect('90:3', 'Dark/Surface', solid(0, 0, 0)),
        rect('90:4', 'Brand/Accent', solid(0, 1, 0)),
    ));

    assert.match(colors!, /static const Color accent = Color\(0xFF00FF00\);/);
    assert.match(colors!, /static const Color lightSurface = Color\(0xFFFFFFFF\);/);
    assert.match(colors!, /static const Color darkSurface = Color\(0xFF000000\);/);
});

test('with primary and surface: fromSeed sets exact roles only, brightness on the ColorScheme, never background', async (t) => {
    const {theme} = await extract(t, palette(
        rect('90:2', 'primary', solid(1, 0, 0)),
        rect('90:3', 'surface', solid(1, 1, 1)),
        rect('90:4', 'accent', solid(0, 1, 0)),
    ), {generateThemeData: true});

    assert.match(theme!, /ColorScheme\.fromSeed\(\s*seedColor: AppColors\.primary,/);
    assert.match(theme!, /brightness: ThemeData\.estimateBrightnessForColor\(AppColors\.surface\),/);
    assert.match(theme!, /primary: AppColors\.primary,/);
    assert.match(theme!, /surface: AppColors\.surface,/);
    assert.doesNotMatch(theme!, /background:|Brightness\.light|\bColors\.|AppColors\.accent|secondary:|error:/);
    assert.equal((theme!.match(/brightness:/g) ?? []).length, 1, 'brightness appears once, on the ColorScheme');
});

test('with primary and no surface, no brightness is emitted', async (t) => {
    const {theme} = await extract(t, palette(rect('90:2', 'primary', solid(1, 0, 0))), {generateThemeData: true});

    assert.match(theme!, /ColorScheme\.fromSeed\(\s*seedColor: AppColors\.primary,/);
    assert.doesNotMatch(theme!, /brightness/);
});

test('a bound variable names the swatch, or its id when the variables endpoint is refused', async (t) => {
    const bound = rect('90:2', 'Rectangle 1', {...solid(1, 0, 0), boundVariables: {color: {type: 'VARIABLE_ALIAS', id: 'VariableID:7:1'}}});
    const named = await extract(t, palette(bound), {extraRoutes: {
        [`/files/${FILE_KEY}/variables/local`]: {body: {meta: {variables: {'VariableID:7:1': {name: 'Brand/Primary'}}}}},
    }});
    const refused = await extract(t, palette(bound), {extraRoutes: {
        [`/files/${FILE_KEY}/variables/local`]: {status: 403, body: {status: 403, err: 'Limited by Figma plan'}},
    }});

    assert.match(named.colors!, /static const Color primary = Color\(0xFFFF0000\);/);
    assert.match(refused.colors!, /static const Color variableID71 = Color\(0xFFFF0000\);/);
    assert.match(refused.report, /variables endpoint refused/i);
});

test('inspect_color_frame skips a hidden fill and shows the alpha of a visible one', async () => {
    const frame = palette(
        rect('90:2', 'Overlay', solid(1, 0, 0, 0.5)),
        {id: '90:3', name: 'Hidden then visible', type: 'RECTANGLE', absoluteBoundingBox: box(40, 40), fills: [{...solid(0, 0, 0), visible: false}, solid(0, 0, 1)]},
    );
    const {text} = await callToolOffline(nodeRoute(frame.id, frame), 'inspect_color_frame', {fileId: FILE_KEY, nodeId: frame.id});

    assert.match(text, /Overlay \(RECTANGLE\)\n   Color: #FF0000 \(50% opacity\)/);
    assert.match(text, /Hidden then visible \(RECTANGLE\)\n   Color: #0000FF\n/);
});

test('a name that is not a Dart identifier falls back to its full path; one that still is not, or that two colours share, is not generated and is reported', async (t) => {
    const {report, colors} = await extract(t, palette(
        rect('90:2', 'Grey/500', solid(0.5, 0.5, 0.5)),
        rect('90:3', 'Brand/default', solid(0, 1, 0)),
        rect('90:4', '500', solid(0, 0, 1)),
        rect('90:5', 'Brand/red', solid(1, 0, 0)),
        rect('90:6', 'Brand/red', solid(0.5, 0, 0)),
        rect('90:7', 'Plain', solid(0, 0, 0)),
    ));

    assert.match(colors!, /static const Color grey500 = Color\(0xFF808080\);/);
    assert.match(colors!, /static const Color brandDefault = Color\(0xFF00FF00\);/);
    assert.match(colors!, /static const Color plain = Color\(0xFF000000\);/);
    assert.doesNotMatch(colors!, /Color 500 |Color red |Color brandRed /);
    assert.equal((colors!.match(/static const Color /g) ?? []).length, 3);
    assert.match(report, /Note: not generated: "500" \(#0000FF\): not a valid Dart identifier\./);
    assert.match(report, /Note: not generated: "Brand\/red" \(#FF0000\): another color has the same name\./);
    assert.match(report, /Note: not generated: "Brand\/red" \(#800000\): another color has the same name\./);
    assert.match(report, /Container\(color: AppColors\.grey500\)/);
    assert.doesNotMatch(report, /AppColors\.500/);
});

test('two swatches with the same name and the same colour give one constant', async (t) => {
    const {report, colors} = await extract(t, palette(
        rect('90:2', 'Brand/red', solid(1, 0, 0)),
        rect('90:3', 'Brand/red', solid(1, 0, 0)),
    ));

    assert.equal((colors!.match(/static const Color red = /g) ?? []).length, 1);
    assert.doesNotMatch(report, /not generated/);
});

test('a lone style named Grey/500 gives grey500, not an invalid identifier', async (t) => {
    const {report, colors} = await extract(t, palette(rect('90:2', 'Grey/500', solid(0.5, 0.5, 0.5))));

    assert.match(colors!, /static const Color grey500 = Color\(0xFF808080\);/);
    assert.match(report, /Container\(color: AppColors\.grey500\)/);
});

test('when no colour can be generated, the report gives no usage example', async (t) => {
    const {report} = await extract(t, palette(rect('90:2', '500', solid(0, 0, 1))));

    assert.match(report, /Note: not generated: "500"/);
    assert.doesNotMatch(report, /Usage Examples|AppColors\./);
});
