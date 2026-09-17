// Loads the browser engine (everything except the DOM/three.js layers) into
// Node so it can be unit tested exactly as it ships — no transpile, no mocks.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENGINE = ['hardware', 'samples', 'step', 'expr', 'java', 'mapping', 'analyze', 'sim'];
const EXPORTS = [
  'HW_PARTS', 'GENERIC', 'hwFromPart', 'specFor',
  'SAMPLE_JAVA', 'DRIVE_JAVA', 'SAMPLE_CAD', 'synthGeometry',
  'splitStepRecords', 'parseSTEP', 'classifyMechs', 'recomputeChain', 'rigCarries', 'rigRoots', 'mlabel',
  'JOINT_KINDS', 'leverOf', 'holdTorque', 'armAngleDeg',
  'parseExpr', 'evalNode', 'parseJava', 'deriveBindings', 'travelRange', 'isCommanded',
  'autoMap', 'wheelCorner', 'detectDrivetrain', 'analyze', 'Sim',
];

export function loadEngine() {
  const src = ENGINE.map((n) => fs.readFileSync(path.join(ROOT, 'src', n + '.js'), 'utf8')).join('\n');
  // Function body: top-level const/let stay private, the return exposes the API.
  return new Function(`"use strict";\n${src}\nreturn { ${EXPORTS.join(', ')} };`)();
}

export const fixture = (name) => fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', name), 'utf8');

/** Fresh sample rig + parsed sample code, the way the app boots. */
export function sampleBench(E, java = E.SAMPLE_JAVA, trust = 'code') {
  const cad = JSON.parse(JSON.stringify(E.SAMPLE_CAD));
  E.classifyMechs(cad.mechs);
  const code = E.parseJava(java);
  const map = E.autoMap(code.devices, cad.mechs);
  const opts = { payloadKg: 0.18, duty: 0.30, trust };
  return { cad, code, map, opts };
}

/** Run the simulator for `seconds` at the app's fixed 50 Hz step. */
export function run(E, seconds) {
  const steps = Math.round(seconds / 0.02);
  for (let i = 0; i < steps; i++) E.Sim.tick(0.02);
}
