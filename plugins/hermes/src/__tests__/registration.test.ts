import { runHarness } from '../harness.js';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import type { Config, ModelRef } from '../types.js';

const tmpDir = '/tmp/hermes-registration-test';

function setupRepo() {
  rmSync(tmpDir, { recursive: true, force: true });
  mkdirSync(`${tmpDir}/src`, { recursive: true });
  mkdirSync(`${tmpDir}/test`, { recursive: true });
  writeFileSync(`${tmpDir}/src/checkout.ts`, 'export const value = "checkout";');
  writeFileSync(`${tmpDir}/src/validator.ts`, 'export const value = "validator";');
  writeFileSync(`${tmpDir}/test/checkout.test.ts`, 'test');
  writeFileSync(`${tmpDir}/package.json`, '{}');
}

let callCount = 0;
let registeredSectionSeen = false;
let createdFileInPlan = false;

const generateFn = async (input: { prompt: string; model?: ModelRef }) => {
  callCount++;

  if (input.prompt.includes('You are the activation module')) {
    // Round 0: activate a brand-new file (does not exist yet)
    if (callCount === 1) {
      return { text: JSON.stringify({
        status: 'PLAN', issue_summary: 'test registration',
        activated_components: [
          { component: 'src/new-file.ts', objective: 'create new file', dependencies: [], communication_targets: [], expected_action: 'modify' },
        ],
        execution_plan: [], rationale: 'test'
      }) };
    }
    // Round 1: activation should see Registered Artifacts
    if (input.prompt.includes('Registered Artifacts')) {
      registeredSectionSeen = true;
      if (input.prompt.includes('src/new-file.ts')) {
        createdFileInPlan = true;
      }
    }
    return { text: JSON.stringify({
      status: 'PLAN', issue_summary: 'test registration',
      activated_components: [
        { component: 'src/new-file.ts', objective: 'verify registration', dependencies: [], communication_targets: [], expected_action: 'modify' },
      ],
      execution_plan: [], rationale: 'test'
    }) };
  }

  if (input.prompt.includes('You are the diagnosis module')) {
    // Round 0: fail so we get a revision round
    if (callCount <= 3) {
      return { text: JSON.stringify({
        status: 'FAIL',
        evidence: ['test failed'],
        summary: 'round 0 failed',
        failure_evidence: [{ source: 'test', evidence: 'fail' }],
        suspected_causes: [{ component: 'src/new-file.ts', reason: 'needs fix' }],
        revision_guidance: [{ component: 'src/new-file.ts', action: 'verify registration' }]
      }) };
    }
    return { text: JSON.stringify({ status: 'PASS', evidence: ['ok'], summary: 'pass' }) };
  }

  if (input.prompt.includes('Component: src/new-file.ts')) {
    // Round 0: create the new file
    if (callCount === 2) {
      return { text: JSON.stringify({
        component: 'src/new-file.ts',
        action: 'modify',
        summary: 'create new file',
        changes: [{ location: 'new-file', description: 'created' }],
        updated_artifact: 'export const value = "new";',
        messages: [],
        validation_notes: []
      }) };
    }
    // Round 1: verify
    return { text: JSON.stringify({
      component: 'src/new-file.ts',
      action: 'no_change',
      summary: 'verify',
      changes: [],
      updated_artifact: 'export const value = "new";',
      messages: [],
      validation_notes: []
    }) };
  }

  return { text: '{}' };
};

async function main() {
  setupRepo();

  const config: Config = {
    evalRepo: tmpDir,
    budget: { B: 1 },
    components: {
      newfile: { file: 'src/new-file.ts', model: { providerID: 'litellm', id: 'newfile-model' } },
    },
    harness: {
      activation: { model: { providerID: 'litellm', id: 'activation-model' } },
      diagnosis: { model: { providerID: 'litellm', id: 'diagnosis-model' } }
    },
    pricing: {
      'activation-model': { input: 1, output: 1 },
      'diagnosis-model': { input: 1, output: 1 },
      'newfile-model': { input: 1, output: 1 }
    }
  };

  const result = await runHarness(config, generateFn, 'test issue', {
    o_shell: 'Exit code: 0', o_test: '', o_runtime: '', o_trace: ''
  });

  // Verify: round 0 primitive has createdArtifacts
  const round0Primitive = result.logs[0]?.primitives[0]?.result;
  if (!round0Primitive?.createdArtifacts || !round0Primitive.createdArtifacts.some((f: string) => f.includes('src/new-file.ts'))) {
    console.error('FAILED: createdArtifacts not set on round 0 primitive', JSON.stringify(round0Primitive?.createdArtifacts));
    process.exit(1);
  }

  // Verify: registered artifacts were passed to activation in round 1
  if (!registeredSectionSeen) {
    console.error('FAILED: Registered Artifacts section not found in round 1 activation prompt');
    process.exit(1);
  }
  if (!createdFileInPlan) {
    console.error('FAILED: src/new-file.ts not found in Registered Artifacts section');
    process.exit(1);
  }

  console.log('createdArtifacts:', JSON.stringify(round0Primitive.createdArtifacts));
  console.log('Registered Artifacts detected in activation prompt:', registeredSectionSeen);
  console.log('Registered file listed:', createdFileInPlan);
  console.log('REGISTRATION TEST: OK');
}

main().catch(err => { console.error('REGISTRATION TEST FAILED:', err); process.exit(1); });