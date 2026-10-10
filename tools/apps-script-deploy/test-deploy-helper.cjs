// Linux mock integration test for the local deployment helper.
// No real clasp, Google, PayPal or npm network operations are run.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const assert = require('node:assert/strict');
if (process.platform === 'win32') {
  console.log('Mock helper integration harness is Linux-only; receiver tests are cross-platform.');
  process.exit(0);
}
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ecosilk-clasp-mock-'));
const bin = path.join(temp, 'bin');
fs.mkdirSync(bin);
const fake = `#!/usr/bin/env node
const fs=require('fs'),path=require('path');
const command=process.argv[4];
const scriptId='1uBgQra4ADrUbU8faOR8kvrUJBuZdC6ex9SPespPnRmWf28yAOZFZ2TOw';
const deployment='AKfycbwPeM3WPX9FI2I0c1fCz4z4khKNy4dE2_mRWYPZt5utZXTFUN7YUJ_3l34A-bkUvoHm';
fs.appendFileSync(path.join(process.env.HOME,'mock-calls.txt'),command+'\\n');
if(command==='clone-script'){
fs.writeFileSync('.clasp.json',JSON.stringify({scriptId,rootDir:'.'}));
fs.writeFileSync('Code.js','function doPost() {}\\nfunction fetchOrderFromPayPal_() {}\\nfunction decrementStock_() {}');
fs.writeFileSync('Other.js','function unrelatedHelper() {return 42;}');
fs.writeFileSync('appsscript.json',JSON.stringify({timeZone:'Australia/Sydney',runtimeVersion:'V8',oauthScopes:['existing-scope']}));
console.log('Cloned');
} else if(command==='list-deployments')console.log(process.env.HIDE_DEPLOYMENT?'none':deployment);
else if(command==='push')console.log('Pushed');
else if(command==='create-version')console.log('Created version 7.');
else if(command==='update-deployment')console.log('Updated');
else process.exit(1);
`;
fs.writeFileSync(path.join(bin, 'npx'), fake, { mode: 0o755 });
const helper = path.join(__dirname, 'deploy-receiver.mjs');
const env = { ...process.env, HOME: temp, PATH: bin + path.delimiter + process.env.PATH };
function run(args, extra = {}) {
  return cp.spawnSync(process.execPath, [helper, ...args], { env: { ...env, ...extra }, encoding: 'utf8' });
}
try {
  let result = run(['stage']);
  assert.equal(result.status, 0, result.stderr);
  const root = path.join(temp, 'ecosilk-receiver-deployment', 'project');
  const backup = path.join(temp, 'ecosilk-receiver-deployment', 'backup', 'original-project');
  assert.match(fs.readFileSync(path.join(root, 'Code.js'), 'utf8'), /checkSandboxReceiverSetup/);
  assert.match(fs.readFileSync(path.join(backup, 'Code.js'), 'utf8'), /decrementStock_/);
  assert.match(fs.readFileSync(path.join(root, 'Other.js'), 'utf8'), /unrelatedHelper/);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'appsscript.json'), 'utf8'));
  assert.equal(manifest.timeZone, 'Australia/Sydney');
  assert.equal(manifest.dependencies.enabledAdvancedServices[0].userSymbol, 'Sheets');
  assert.ok(manifest.oauthScopes.includes('existing-scope'));
  assert.ok(!fs.readFileSync(path.join(temp, 'mock-calls.txt'), 'utf8').includes('push'));
  console.log('PASS stage preserves unrelated files, backup and manifest; no remote writes');
  assert.notEqual(run(['stage']).status, 0);
  console.log('PASS duplicate staging refuses overwrite');
  assert.notEqual(run(['activate', '--setup-verified']).status, 0);
  console.log('PASS activation before upload refused');
  assert.notEqual(run(['push-head'], { HIDE_DEPLOYMENT: '1' }).status, 0);
  console.log('PASS missing expected deployment blocks upload');
  result = run(['push-head']); assert.equal(result.status, 0, result.stderr);
  assert.notEqual(run(['activate']).status, 0);
  console.log('PASS upload and activation remain separate; setup acknowledgement required');
  result = run(['activate', '--setup-verified']); assert.equal(result.status, 0, result.stderr);
  const state = JSON.parse(fs.readFileSync(path.join(temp, 'ecosilk-receiver-deployment', 'handoff-state.json'), 'utf8'));
  assert.equal(state.createdVersion, 7); assert.ok(state.activatedAt);
  console.log('PASS activation uses parsed version and existing deployment');
  console.log('6 helper checks passed using fake clasp only.');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
