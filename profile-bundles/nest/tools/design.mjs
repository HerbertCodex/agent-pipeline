/** Measures each production function independently using the host TypeScript parser. */
export function measure(ts, source) {
  const file = ts.createSourceFile("source.ts", source, ts.ScriptTarget.Latest, true);
  const functions = [];
  const isFunction = (node) => ts.isFunctionLike(node) && node.body;
  const control = new Set([ts.SyntaxKind.IfStatement, ts.SyntaxKind.ForStatement, ts.SyntaxKind.ForOfStatement,
    ts.SyntaxKind.ForInStatement, ts.SyntaxKind.WhileStatement, ts.SyntaxKind.DoStatement,
    ts.SyntaxKind.SwitchStatement, ts.SyntaxKind.CatchClause]);
  function visit(node) {
    if (isFunction(node)) {
      let complexity = 1;
      let nesting = 0;
      function body(child, depth) {
        if (isFunction(child)) return;
        const nextDepth = depth + (control.has(child.kind) ? 1 : 0);
        nesting = Math.max(nesting, nextDepth);
        if (control.has(child.kind) || ts.isConditionalExpression(child) || ts.isCaseClause(child)) complexity += 1;
        if (ts.isBinaryExpression(child) && [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(child.operatorToken.kind)) complexity += 1;
        ts.forEachChild(child, (nested) => body(nested, nextDepth));
      }
      body(node.body, 0);
      const start = file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
      const end = file.getLineAndCharacterOfPosition(node.end).line + 1;
      functions.push({ line: start, name: node.name?.getText(file) ?? "anonymous", complexity, function_lines: end - start + 1, parameters: node.parameters.length, nesting });
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return functions;
}

export function violations(metrics, limits) {
  return metrics.flatMap((entry) => Object.entries(limits)
    .filter(([key, bound]) => entry[key] > bound)
    .map(([key, bound]) => `${entry.line}: ${entry.name}: ${key} ${entry[key]} > ${bound}`));
}
