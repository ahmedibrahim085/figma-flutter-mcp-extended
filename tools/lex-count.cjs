// Cross-check for literal-scan.cjs: count literal TOKENS with the TypeScript lexer (a second method).
// Digits and quotes inside regex literals count here but not in literal-scan (the lexer has no parser context).
// Usage: node tools/lex-count.cjs [repo]
const fs = require('fs'), path = require('path');
const repo = process.argv[2] ?? path.resolve(__dirname, '..');
const ts = require(require.resolve('typescript', {paths: [repo]}));
const c = {num: 0, str: 0, tmplNoSub: 0, tmplHead: 0};
(function walk(d) { for (const e of fs.readdirSync(d, {withFileTypes: true})) { const p = path.join(d, e.name);
  if (e.isDirectory()) walk(p); else if (p.endsWith('.ts')) {
    const s = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, fs.readFileSync(p, 'utf8'));
    const braces = []; // per open template: count of nested { inside its current substitution
    for (let t = s.scan(); t !== ts.SyntaxKind.EndOfFileToken; t = s.scan()) {
      if (t === ts.SyntaxKind.OpenBraceToken && braces.length) braces[braces.length - 1]++;
      else if (t === ts.SyntaxKind.CloseBraceToken && braces.length) {
        if (braces[braces.length - 1] === 0) {
          t = s.reScanTemplateToken(false);
          if (t === ts.SyntaxKind.TemplateTail) braces.pop();
          continue;
        }
        braces[braces.length - 1]--;
      }
      if (t === ts.SyntaxKind.NumericLiteral || t === ts.SyntaxKind.BigIntLiteral) c.num++;
      else if (t === ts.SyntaxKind.StringLiteral) c.str++;
      else if (t === ts.SyntaxKind.NoSubstitutionTemplateLiteral) c.tmplNoSub++;
      else if (t === ts.SyntaxKind.TemplateHead) { c.tmplHead++; braces.push(0); }
    } } } })(path.join(repo, 'src'));
console.log(JSON.stringify(c));
