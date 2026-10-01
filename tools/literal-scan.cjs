// Literal inventory: every numeric, string, template and regex literal in src/**/*.ts,
// with file:line, kind, text and syntactic context. Usage: node tools/literal-scan.cjs [repo] > literals.tsv
const fs = require('fs');
const path = require('path');

const repo = process.argv[2] ?? path.resolve(__dirname, '..');
const ts = require(require.resolve('typescript', {paths: [repo]}));
const files = [];
(function walk(dir) {
    for (const e of fs.readdirSync(dir, {withFileTypes: true})) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (p.endsWith('.ts')) files.push(p);
    }
})(path.join(repo, 'src'));

const clean = (s) => s.replace(/\t/g, '\\t').replace(/\r?\n/g, '\\n').slice(0, 160);

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

console.log(['file', 'line', 'kind', 'text', 'context', 'function'].join('\t'));
for (const file of files) {
    const src = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    const rel = path.relative(repo, file);
    const emit = (node, kind, text) => {
        const line = src.getLineAndCharacterOfPosition(node.getStart()).line + 1;
        console.log([rel, line, kind, clean(text), clean(context(node)), clean(fnName(node))].join('\t'));
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
