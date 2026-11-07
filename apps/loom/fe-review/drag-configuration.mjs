import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

/** Read the actual component override; unsupported syntax is a hard refusal. */
export function parseDragConfiguration(source) {
  const tree = ts.createSourceFile('CanvasSurface.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  assert.equal(tree.parseDiagnostics.length, 0, 'REVIEW_DRAG_CONFIG_SYNTAX');
  const bindings = [];
  for (const statement of tree.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || statement.moduleSpecifier.text !== '@xyflow/react') continue;
    const named = statement.importClause?.namedBindings;
    if (named && ts.isNamedImports(named)) for (const item of named.elements) {
      if ((item.propertyName ?? item.name).text === 'ReactFlow' && !statement.importClause.isTypeOnly && !item.isTypeOnly) bindings.push(item.name.text);
    }
  }
  assert.equal(bindings.length, 1, 'REVIEW_DRAG_CONFIG_IMPORT');
  const flows = [];
  function visit(node) {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(tree) === bindings[0]) flows.push(node);
    ts.forEachChild(node, visit);
  }
  visit(tree);
  assert.equal(flows.length, 1, 'REVIEW_DRAG_CONFIG_COMPONENT');
  const attributes = flows[0].attributes.properties;
  assert.ok(!attributes.some(ts.isJsxSpreadAttribute), 'REVIEW_DRAG_CONFIG_SPREAD');
  const matches = attributes.filter((item) => ts.isJsxAttribute(item) && item.name.getText(tree) === 'nodeDragThreshold');
  assert.equal(matches.length, 1, 'REVIEW_DRAG_CONFIG_ATTRIBUTE');
  const initializer = matches[0].initializer;
  assert.ok(initializer && ts.isJsxExpression(initializer) && initializer.expression && ts.isNumericLiteral(initializer.expression), 'REVIEW_DRAG_CONFIG_LITERAL');
  const threshold = Number(initializer.expression.text);
  assert.ok(Number.isInteger(threshold) && threshold >= 1 && threshold <= 16, 'REVIEW_DRAG_CONFIG_RANGE');
  return Object.freeze({ threshold, sourceSha256: createHash('sha256').update(source).digest('hex') });
}
export const actualDragConfiguration = parseDragConfiguration(readFileSync(new URL('../src/surfaces/canvas/CanvasSurface.tsx', import.meta.url), 'utf8'));
