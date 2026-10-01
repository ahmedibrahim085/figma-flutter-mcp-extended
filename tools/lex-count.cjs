// Cross-check for literal-scan.cjs: count literal TOKENS with the TypeScript lexer (a second method).
// Digits and quotes inside regex literals count here but not in literal-scan (the lexer has no parser context).
// Usage: node tools/lex-count.cjs [repo]
const fs = require('fs');
const path = require('path');

const repo = process.argv[2] ?? path.resolve(__dirname, '..');
const ts = require(require.resolve('typescript', {paths: [repo]}));

const counts = {num: 0, str: 0, tmplNoSub: 0, tmplHead: 0};

function countFile(file) {
    const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, fs.readFileSync(file, 'utf8'));
    // One entry per open template literal: how many `{` are open inside its current substitution.
    const braces = [];
    for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
        if (token === ts.SyntaxKind.OpenBraceToken && braces.length) {
            braces[braces.length - 1]++;
        } else if (token === ts.SyntaxKind.CloseBraceToken && braces.length) {
            if (braces[braces.length - 1] === 0) {
                // This `}` closes a substitution, so the template literal continues here.
                token = scanner.reScanTemplateToken(false);
                if (token === ts.SyntaxKind.TemplateTail) braces.pop();
                continue;
            }
            braces[braces.length - 1]--;
        }
        if (token === ts.SyntaxKind.NumericLiteral || token === ts.SyntaxKind.BigIntLiteral) counts.num++;
        else if (token === ts.SyntaxKind.StringLiteral) counts.str++;
        else if (token === ts.SyntaxKind.NoSubstitutionTemplateLiteral) counts.tmplNoSub++;
        else if (token === ts.SyntaxKind.TemplateHead) {
            counts.tmplHead++;
            braces.push(0);
        }
    }
}

(function walk(dir) {
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(p);
        else if (p.endsWith('.ts')) countFile(p);
    }
})(path.join(repo, 'src'));

console.log(JSON.stringify(counts));
