const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
const files = [...new Set(git('ls-files', '--cached', '--others', '--exclude-standard', '-z').split('\0').filter(Boolean))].sort();
const sourceSha256 = {};
for (const file of files) {
  const absolute = path.join(root, file);
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) throw new Error(`Missing source: ${file}`);
  sourceSha256[file] = crypto.createHash('sha256').update(fs.readFileSync(absolute)).digest('hex');
}
const current = { head: git('rev-parse', 'HEAD').trim(), sourceSha256 };
const [mode, file] = process.argv.slice(2);
if (!file || !['write', 'check'].includes(mode)) throw new Error('Usage: node verification/record-sources.cjs write|check /path/to/receipt.json');
if (mode === 'write') {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(current, null, 2) + '\n');
  console.log(JSON.stringify({ status: 'RECORDED', head: current.head, files: files.length }));
} else {
  const recorded = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (JSON.stringify(recorded) !== JSON.stringify(current)) throw new Error('The source changed during verification; this result cannot qualify the recorded revision.');
  console.log(JSON.stringify({ status: 'PASS', head: current.head, files: files.length, assertion: 'source unchanged since receipt' }));
}
