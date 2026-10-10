/**
 * Local Claude Code handoff. No secrets in this file.
 * stage = clone + backup + prepare; push-head = upload undeployed source;
 * activate = update only the pre-existing webhook deployment.
 * Uses the local user's existing clasp Google login.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_ID = '1uBgQra4ADrUbU8faOR8kvrUJBuZdC6ex9SPespPnRmWf28yAOZFZ2TOw';
const DEPLOYMENT_ID = 'AKfycbwPeM3WPX9FI2I0c1fCz4z4khKNy4dE2_mRWYPZt5utZXTFUN7YUJ_3l34A-bkUvoHm';
const SHEET_ID = '1ocRweWN_gBlzv2gb4WtinX1sWzJTxFCJ_dn3UkBGu_g';
const mode = process.argv[2] || 'help';
const workspace = path.join(os.homedir(), 'ecosilk-receiver-deployment');
const project = path.join(workspace, 'project');
const stateFile = path.join(workspace, 'handoff-state.json');

function clasp(args, cwd = project) {
  // Inputs below are fixed constants or numeric versions; no secrets are args.
  const r = spawnSync('npx', ['--yes', '@google/clasp@3.4.1', ...args],
    { cwd, encoding: 'utf8', shell: process.platform === 'win32' });
  if (r.error) throw r.error;
  if (r.status !== 0) {
    throw new Error(`clasp ${args[0]} failed. Resolve the local Google login/API permission issue; do not paste tokens into chat.`);
  }
  return (r.stdout || '') + (r.stderr || '');
}

function sourceFiles(root) {
  const files = [];
  function scan(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['.git', 'node_modules'].includes(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) scan(full);
      else if (/\.(gs|js)$/.test(entry.name)) files.push(full);
      if (files.length > 200) throw new Error('Unexpectedly large script project; review manually');
    }
  }
  scan(root);
  return files;
}

function readState() {
  if (!fs.existsSync(stateFile)) throw new Error('Run stage first');
  return JSON.parse(fs.readFileSync(stateFile, 'utf8'));
}

function validateTarget() {
  const config = JSON.parse(fs.readFileSync(path.join(project, '.clasp.json'), 'utf8'));
  assert.equal(config.scriptId, SCRIPT_ID, 'Wrong Apps Script project; refusing upload');
}

function requireExistingDeployment() {
  validateTarget();
  const deployments = clasp(['list-deployments']);
  if (!deployments.includes(DEPLOYMENT_ID))
    throw new Error('Expected webhook deployment is not visible. Stop; do not create a replacement deployment.');
}

function stage() {
  if (fs.existsSync(stateFile) || fs.existsSync(path.join(project, '.clasp.json')))
    throw new Error(`A staged project already exists at ${workspace}. Reuse it; do not overwrite its backup.`);
  fs.mkdirSync(project, { recursive: true });
  console.log('Cloning existing Apps Script with your local clasp login. No remote write yet.');
  clasp(['clone-script', SCRIPT_ID]);
  validateTarget();
  requireExistingDeployment();
  const config = JSON.parse(fs.readFileSync(path.join(project, '.clasp.json'), 'utf8'));
  const root = config.rootDir ? path.resolve(project, config.rootDir) : project;
  if (!root.startsWith(project + path.sep) && root !== project)
    throw new Error('Unexpected rootDir outside staging directory; refusing edits');
  const files = sourceFiles(root);
  const receivers = files.filter(file => /\bfunction\s+doPost\s*\(/.test(fs.readFileSync(file, 'utf8')));
  if (receivers.length !== 1) throw new Error('Expected exactly one existing doPost source; review project manually');
  const receiver = receivers[0];
  const oldSource = fs.readFileSync(receiver, 'utf8');
  if (!oldSource.includes('fetchOrderFromPayPal_') || !oldSource.includes('decrementStock_'))
    throw new Error('Remote receiver differs from the supplied original; review before replacing it');
  fs.mkdirSync(path.join(workspace, 'backup'), { recursive: true });
  fs.cpSync(project, path.join(workspace, 'backup', 'original-project'), { recursive: true });
  fs.copyFileSync(path.join(HERE, 'ecosilk-order-receiver-reviewed.gs'), receiver);
  const manifestPath = path.join(root, 'appsscript.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.runtimeVersion = 'V8';
  manifest.dependencies ||= {};
  const services = manifest.dependencies.enabledAdvancedServices ||= [];
  const existing = services.find(service => service.serviceId === 'sheets' || service.userSymbol === 'Sheets');
  if (existing && (existing.serviceId !== 'sheets' || existing.userSymbol !== 'Sheets'))
    throw new Error('Advanced Sheets service alias conflicts; resolve manually');
  if (!existing) services.push({ userSymbol: 'Sheets', serviceId: 'sheets', version: 'v4' });
  // Preserve automatic scope detection when no explicit list was configured.
  if (Array.isArray(manifest.oauthScopes)) {
    for (const scope of ['https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/script.external_request',
      'https://www.googleapis.com/auth/script.send_mail']) {
      if (!manifest.oauthScopes.includes(scope)) manifest.oauthScopes.push(scope);
    }
  }
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  fs.writeFileSync(stateFile, JSON.stringify({ scriptId: SCRIPT_ID, deploymentId: DEPLOYMENT_ID,
    sheetId: SHEET_ID, source: path.relative(project, receiver), stagedAt: new Date().toISOString(),
    backup: path.join(workspace, 'backup', 'original-project') }, null, 2) + '\n');
  console.log(`Staged safely at ${project}. Original source backed up outside the upload directory.`);
  console.log('Review the diff before push-head. No remote source or deployment has changed.');
}

if (Number(process.versions.node.split('.')[0]) < 20) throw new Error('Node.js 20+ is required for pinned clasp 3.4.1');
try {
  if (mode === 'stage') stage();
  else if (mode === 'push-head') {
    const state = readState(); requireExistingDeployment();
    console.log('Uploading the staged source and manifest; the existing webhook version remains unchanged.');
    console.log(clasp(['push', '--force']));
    state.headUploadedAt = new Date().toISOString();
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2) + '\n');
    console.log('Now set missing Script Properties and run checkSandboxReceiverSetup in the Apps Script editor.');
    console.log('Activate only after that read-only check reports ready:true.');
  } else if (mode === 'activate') {
    const state = readState();
    if (!state.headUploadedAt) throw new Error('Run push-head first');
    if (!process.argv.includes('--setup-verified'))
      throw new Error('After checkSandboxReceiverSetup reports ready:true, pass --setup-verified');
    requireExistingDeployment();
    const output = clasp(['create-version', 'Ecosilk-reviewed-sandbox-receiver']);
    const match = output.match(/(?:Created\s+version|Version)\s+(\d+)/i);
    if (!match) throw new Error('Version output not recognised; do not guess. Inspect list-versions manually.');
    const version = match[1];
    state.createdVersion = Number(version);
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2) + '\n');
    console.log(clasp(['update-deployment', DEPLOYMENT_ID, '--versionNumber', version,
      '--description', 'Reviewed-sandbox-receiver']));
    state.activatedAt = new Date().toISOString();
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2) + '\n');
    console.log(`Existing webhook updated to version ${version}. URL preserved.`);
    console.log('No checkout has been made. Complete the buyer sandbox checkout and reconcile the Sheet.');
  } else {
    console.log('Usage: node deploy-receiver.mjs stage | push-head | activate --setup-verified');
    console.log('Run under Claude Code on your own machine with the existing clasp Google login.');
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
