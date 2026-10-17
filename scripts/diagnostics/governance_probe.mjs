// Offline: extract only pure governance functions, never import the Worker module.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
const [sourcePath, typescriptPath, ...cloudFiles] = process.argv.slice(2);
if (!sourcePath || !typescriptPath) throw new Error('Usage: node governance_probe.mjs api.mts /path/to/typescript [ph_*.json]');
const ts = createRequire(import.meta.url)(typescriptPath);
const source = fs.readFileSync(sourcePath, 'utf8');
const ast = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const factory = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'createApi');
const statements = [...ast.statements, ...(factory?.body?.statements || [])];
const names = ['mean', 'clamp', 'toNumber', 'actualField', 'directionField', 'correctField', 'errorField', 'horizonStatistics', 'evaluateModelGovernance'];
const declarations = names.map(name => {
  const declaration = statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name);
  if (!declaration || declaration.modifiers?.some(m => m.kind === ts.SyntaxKind.AsyncKeyword)) throw new Error(`Missing/non-pure declaration: ${name}`);
  return declaration.getText(ast);
});
const version = ast.statements.flatMap(n => ts.isVariableStatement(n) ? [...n.declarationList.declarations] : [])
  .find(n => n.name.getText(ast) === 'MODEL_GOVERNANCE_VERSION')?.initializer?.getText(ast);
assert.ok(version);
const code = ts.transpileModule(`const MODEL_GOVERNANCE_VERSION = ${version};\n${declarations.join('\n')}`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }
}).outputText;
const context = vm.createContext({}); // No fetch, store, process, require or filesystem inside sandbox.
vm.runInContext(code, context, { timeout: 1000 });
function run(rows, previous = null) {
  context.input = rows;
  context.previous = previous;
  const result = vm.runInContext('evaluateModelGovernance("TEST", input, previous)', context, { timeout: 1000 });
  return { status: result.status, active_model: result.active_model, samples: result.live_samples_20,
    edge: result.direction_edge_20, accuracy20: result.accuracy_20, accuracy60: result.accuracy_60 };
}
function sample(n, hits) {
  return Array.from({ length: n }, (_, i) => ({
    As_Of_Date: new Date(Date.UTC(2026, 0, i+1)).toISOString().slice(0, 10),
    Best_Model: i % 2 ? 'A' : 'B', Actual_1D_Return: i % 2 ? .01 : -.01,
    Actual_1D_Direction: i % 2 ? 'Up' : 'Down', Raw_Direction_Correct: i < hits ? 1 : 0,
  }));
}
const cases = {
  insufficient_previous_rollback: run(sample(19, 5), { status: 'rollback' }),
  negative_edge: run(sample(20, 9)),
  zero_edge_initial: run(sample(20, 10)),
  zero_edge_previous_rollback: run(sample(20, 10), { status: 'rollback' }),
  positive_edge_exit: run(sample(20, 11), { status: 'rollback' }),
};
assert.equal(cases.insufficient_previous_rollback.status, 'warming_up');
assert.equal(cases.negative_edge.status, 'rollback');
assert.equal(cases.zero_edge_initial.status, 'watch');
assert.equal(cases.zero_edge_previous_rollback.status, 'rollback');
assert.equal(cases.positive_edge_exit.status, 'stable');
const original = sample(20, 11);
assert.deepEqual(run(original), run(original.map(r => ({ ...r, Best_Model: 'arbitrary replacement' }))));
const dropRows = sample(60, 60);
for (let i = 40; i < 60; i++) dropRows[i].Raw_Direction_Correct = i < 51 ? 1 : 0;
cases.positive_edge_but_accuracy_drop = run(dropRows, { status: 'rollback' });
assert.equal(cases.positive_edge_but_accuracy_drop.status, 'watch');
const historical = cloudFiles.map(file => {
  const bytes = fs.readFileSync(file);
  const rows = JSON.parse(bytes).data.live.records;
  return { source: file.split('/').at(-1), sha256: createHash('sha256').update(bytes).digest('hex'),
    // This is a current settled-snapshot calculation, not a historical replay.
    current_snapshot_from_rollback: run(rows, { status: 'rollback' }),
    current_snapshot_from_stable: run(rows, { status: 'stable' }) };
});
console.log(JSON.stringify({ source_sha256: createHash('sha256').update(source).digest('hex'),
  extracted_functions: names, checks_passed: 7, cases, historical }, null, 2));
