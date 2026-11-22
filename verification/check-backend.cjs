// Strictly type-check real source and its imported modules without installing
// the unrelated monorepo file: packages or calling an external service.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..');
const modules = path.resolve(process.env.VIDA_AIDE_VERIFICATION_NODE_MODULES || path.join(__dirname, 'node_modules'));
const load = createRequire(path.join(path.dirname(modules), 'package.json'));
const ts = load('typescript');
const config = ts.readConfigFile(path.join(root, 'tsconfig.json'), ts.sys.readFile);
if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
const options = ts.parseJsonConfigFileContent(config.config, ts.sys, root).options;
Object.assign(options, {
  noEmit: true, incremental: false, preserveSymlinks: true,
  types: ['node'], typeRoots: [path.join(modules, '@types')],
});
const host = ts.createCompilerHost(options);
host.resolveModuleNames = (names, containingFile) => names.map((name) =>
  ts.resolveModuleName(name, containingFile, options, host).resolvedModule ||
  ts.resolveModuleName(name, path.join(path.dirname(modules), 'verification-entry.ts'), options, host).resolvedModule);
const targets = process.argv.slice(2);
if (!targets.length) targets.push('src/app/api/scan/route.ts', 'src/lib/scan-result.ts');
const program = ts.createProgram(targets.map((file) => path.resolve(root, file)), options, host);
const diagnostics = ts.getPreEmitDiagnostics(program);
if (diagnostics.length) {
  process.stderr.write(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCurrentDirectory: () => root, getNewLine: () => '\n', getCanonicalFileName: (file) => file,
  }));
}
const source = program.getSourceFiles().filter((file) => !file.isDeclarationFile && file.fileName.startsWith(root + path.sep));
const sourceSha256 = Object.fromEntries(source.map((file) => [
  path.relative(root, file.fileName), crypto.createHash('sha256').update(fs.readFileSync(file.fileName)).digest('hex'),
]));
console.log(JSON.stringify({
  status: diagnostics.length ? 'FAIL' : 'PASS', scope: 'targeted strict source typecheck',
  diagnostics: diagnostics.length, typescript: ts.version, targets, sourceSha256,
}));
process.exitCode = diagnostics.length ? 1 : 0;
