// Literal inventory: every numeric, string, template and regex literal in src/**/*.ts,
// with file:line, kind, text and syntactic context. Usage: node tools/literal-scan.cjs [repo] > literals.tsv
// With --check it compares the inventory with tools/literal-baseline.tsv instead and exits 1 on a new or a gone literal.
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const checking = args.includes('--check');
const repo = args.find((a) => a !== '--check') ?? path.resolve(__dirname, '..');
const ts = require(require.resolve('typescript', {paths: [repo, __dirname]}));
const files = [];
(function walk(dir) {
    for (const e of fs.readdirSync(dir, {withFileTypes: true})) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (p.endsWith('.ts')) files.push(p);
    }
})(path.join(repo, 'src'));

// Tab and newline are written as \t and \n; any other control character (a NUL separator in a hash input) as \xNN, so a
// baseline line never holds a byte that tools treat as the end of the line.
const clean = (s) => s.replace(/\t/g, '\\t').replace(/\r?\n/g, '\\n').replace(/[\x00-\x1f\x7f]/g, (c) => `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}`).slice(0, 160);

function fnName(node) {
    for (let n = node.parent; n; n = n.parent) {
        if ((ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n)) && n.name) return n.name.getText();
        if ((ts.isArrowFunction(n) || ts.isFunctionExpression(n)) && n.parent) {
            const p = n.parent;
            if (ts.isVariableDeclaration(p) || ts.isPropertyAssignment(p) || ts.isPropertyDeclaration(p)) return p.name.getText();
        }
        if (ts.isVariableDeclaration(n) && ts.isSourceFile(n.parent.parent.parent)) return n.name.getText();
        if (ts.isClassDeclaration(n) && n.name) return n.name.getText();
    }
    return '(module)';
}

function context(node) {
    let n = node, p = node.parent;
    if (ts.isPrefixUnaryExpression(p)) { n = p; p = p.parent; }
    if (ts.isTemplateSpan(p) || ts.isTemplateExpression(p)) return 'template';
    if (ts.isBinaryExpression(p)) return `binary(${ts.tokenToString(p.operatorToken.kind)})`;
    if (ts.isPropertyAssignment(p)) return p.name === n ? 'object-key' : `prop(${p.name.getText()})`;
    if (ts.isVariableDeclaration(p)) return `var(${p.name.getText()})`;
    if (ts.isPropertyDeclaration(p)) return `field(${p.name.getText()})`;
    if (ts.isParameter(p)) return `param-default(${p.name.getText()})`;
    if (ts.isCaseClause(p)) return 'case';
    if (ts.isReturnStatement(p)) return 'return';
    if (ts.isElementAccessExpression(p)) return 'index';
    if (ts.isArrayLiteralExpression(p)) {
        const q = p.parent;
        if (ts.isVariableDeclaration(q)) return `array(${q.name.getText()})`;
        if (ts.isPropertyAssignment(q)) return `array(${q.name.getText()})`;
        if (ts.isCallExpression(q)) return `array-arg(${q.expression.getText().slice(-40)})`;
        return 'array';
    }
    if (ts.isCallExpression(p) || ts.isNewExpression(p)) return `arg(${p.expression.getText().slice(-40)})`;
    if (ts.isConditionalExpression(p)) return 'ternary';
    if (ts.isEnumMember(p)) return `enum(${p.name.getText()})`;
    return ts.SyntaxKind[p.kind];
}

function inType(node) {
    for (let n = node.parent; n; n = n.parent) {
        if (ts.isTypeNode(n)) return true;
        if (ts.isStatement(n) || ts.isExpression(n) && !ts.isLiteralExpression(n)) return false;
    }
    return false;
}

const rows = [];
for (const file of files) {
    const src = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    const rel = path.relative(repo, file);
    const emit = (node, kind, text) => {
        const line = src.getLineAndCharacterOfPosition(node.getStart()).line + 1;
        rows.push({line, cells: [rel, kind, clean(text), clean(context(node)), clean(fnName(node))]});
    };
    (function visit(node) {
        const p = node.parent;
        const isModuleSpec = p && (ts.isImportDeclaration(p) || ts.isExportDeclaration(p)) && p.moduleSpecifier === node;
        if (!isModuleSpec) {
            if (ts.isNumericLiteral(node) || ts.isBigIntLiteral(node)) {
                const neg = ts.isPrefixUnaryExpression(p) && p.operator === ts.SyntaxKind.MinusToken;
                emit(node, inType(node) ? 'type-number' : 'number', (neg ? '-' : '') + node.text);
            } else if (ts.isStringLiteral(node)) {
                emit(node, inType(node) ? 'type-string' : 'string', node.text);
            } else if (ts.isNoSubstitutionTemplateLiteral(node)) {
                emit(node, 'template', node.text);
            } else if (ts.isTemplateExpression(node)) {
                emit(node, 'template', node.head.text + node.templateSpans.map((s) => '${…}' + s.literal.text).join(''));
            } else if (ts.isRegularExpressionLiteral(node)) {
                emit(node, 'regex', node.text);
            }
        }
        ts.forEachChild(node, visit);
    })(src);
}

if (!checking) {
    console.log(['file', 'line', 'kind', 'text', 'context', 'function'].join('\t'));
    for (const {line, cells} of rows) console.log([cells[0], line, ...cells.slice(1)].join('\t'));
} else {
    // A literal is identified by file|kind|text|context|function with a count; the line is left out so
    // unrelated edits above it do not re-key it. Moving code to another function or file does re-key it.
    const baselineFile = path.join(repo, 'tools', 'literal-baseline.tsv');
    const keyOf = (cells) => cells.slice(0, 5).join('\t');
    const allowed = new Map();
    for (const line of fs.readFileSync(baselineFile, 'utf8').split('\n').slice(1)) {
        if (line === '') continue;
        const cells = line.split('\t');
        allowed.set(keyOf(cells), {count: Number(cells[5]), line});
    }
    const seen = new Map();
    const problems = [];
    for (const [key, {line}] of allowed) {
        const [, , , , , , klass, reason] = line.split('\t');
        const missing = [klass?.trim() ? '' : 'no class', reason?.trim() ? '' : 'no reason'].filter(Boolean);
        if (missing.length > 0) {
            problems.push(`tools/literal-baseline.tsv: ${key}\n  has ${missing.join(' and ')}. Every baseline row needs its class and the reason the literal may stay.\n  ${line}`);
        }
    }
    for (const {line, cells} of rows) {
        const key = keyOf(cells);
        const n = (seen.get(key) ?? 0) + 1;
        seen.set(key, n);
        const have = allowed.get(key)?.count ?? 0;
        if (n > have) {
            problems.push(`${cells[0]}:${line}  ${cells[1]} ${cells[2]}  in ${cells[4]}, ${cells[3]}\n` +
                `  is not in tools/literal-baseline.tsv (key seen ${n} time(s), baseline allows ${have}).\n` +
                '  A fact (a cap, threshold, default, URL, name or list that Figma, Flutter or the owner decides)\n' +
                "  belongs in src/defaults.json, read with `import defaults from '…/defaults.json' with {type: 'json'}`.\n" +
                '  If it is logic, a protocol constant, a schema, emitted Dart, report text or a unit conversion, add this line\n' +
                '  to tools/literal-baseline.tsv with its class and reason (count = how many times the key occurs):\n' +
                `  ${key}\t${n}\t<class>\t<reason>\n` +
                '  Moving code to another file or function re-keys its literals: delete the old line and add the new one.');
        }
    }
    for (const [key, {count, line}] of allowed) {
        const found = seen.get(key) ?? 0;
        if (found < count) {
            problems.push(`tools/literal-baseline.tsv: ${key}\n` +
                `  is listed ${count} time(s) but found ${found} time(s) in src. Delete the line (or lower its count) so the baseline only shrinks.\n` +
                `  ${line}`);
        }
    }
    if (problems.length > 0) {
        console.error(problems.join('\n\n'));
        process.exit(1);
    }
}
