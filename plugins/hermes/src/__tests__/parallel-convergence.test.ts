import { runHarness } from '../harness.js';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import type { Config, ModelRef, Plan } from '../types.js';

const tmpDir = '/tmp/hermes-parallel-convergence-test';

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
const generateFn = async (input: { prompt: string; model?: ModelRef }) => {
  callCount++;

  if (input.prompt.includes('You are the activation module')) {
    return { text: JSON.stringify({
      status: 'PLAN', issue_summary: 'test parallel convergence',
      activated_components: [
        {
          component: 'src/checkout.ts',
          objective: 'coordinate with validator',
          dependencies: ['src/validator.ts'],
          communication_targets: ['src/validator.ts'],
          expected_action: 'modify'
        },
        {
          component: 'src/validator.ts',
          objective: 'signal checkout',
          dependencies: [],
          communication_targets: ['src/checkout.ts'],
          expected_action: 'modify'
        }
      ],
      execution_plan: [], rationale: 'test'
    }) };
  }
  if (input.prompt.includes('You are the diagnosis module')) {
    return { text: JSON.stringify({ status: 'PASS', evidence: ['ok'], summary: 'pass' }) };
  }
  if (input.prompt.includes('Component: src/checkout.ts')) {
    const hasMsg = input.prompt.includes('From src/validator.ts to src/checkout.ts') && input.prompt.includes('signal=READY');
    const artifact = hasMsg ? `export const value = "checkout-coordinated";` : `export const value = "checkout-uncoordinated";`;
    return { text: JSON.stringify({
      component: 'src/checkout.ts', action: 'modify',
      summary: hasMsg ? 'Saw message from validator' : 'No message yet',
      changes: [{ location: 'value', description: hasMsg ? 'coordinated' : 'uncoordinated' }],
      updated_artifact: artifact,
      messages: [], validation_notes: []
    }) };
  }
  if (input.prompt.includes('Component: src/validator.ts')) {
    return { text: JSON.stringify({
      component: 'src/validator.ts', action: 'modify',
      summary: 'Sending signal to checkout',
      changes: [{ location: 'value', description: 'sent signal' }],
      updated_artifact: 'export const value = "validator";',
      messages: [{ target: 'src/checkout.ts', message: 'signal=READY' }],
      validation_notes: []
    }) };
  }
  return { text: '{}' };
};

async function main() {
  setupRepo();

  const config: Config = {
    evalRepo: tmpDir,
    budget: { B: 0 },
    components: {
      checkout: { file: 'src/checkout.ts', model: { providerID: 'test', id: 'm1' } },
      validator: { file: 'src/validator.ts', model: { providerID: 'test', id: 'm2' } }
    },
    harness: {
      activation: { model: { providerID: 'test', id: 'act' } },
      diagnosis: { model: { providerID: 'test', id: 'diag' } }
    },
    parallelPrimitives: true,
    __testMaxPassesPerComponent: 3
  };

  const result = await runHarness(config, generateFn, 'test issue', {
    o_shell: 'Exit code: 0', o_test: '', o_runtime: '', o_trace: ''
  });

  const checkoutPrimitives = result.logs[0].primitives.filter(p => p.component === 'src/checkout.ts');
  const lastCheckout = checkoutPrimitives[checkoutPrimitives.length - 1];

  console.log('Checkout runs:', checkoutPrimitives.length);
  console.log('Last checkout artifact:', lastCheckout?.result.updated_artifact);

  // In parallel mode, validator runs first (no deps), sends message to checkout,
  // then checkout runs and receives the message → coordinated
  if (!lastCheckout?.result.updated_artifact.includes('checkout-coordinated')) {
    console.error('FAILED: checkout should be coordinated after receiving message from validator');
    console.error('  Expected: "checkout-coordinated"');
    console.error('  Got:', lastCheckout?.result.updated_artifact);
    process.exit(1);
  }

  // Verify: validator also ran
  const validatorPrimitives = result.logs[0].primitives.filter(p => p.component === 'src/validator.ts');
  if (validatorPrimitives.length === 0) {
    console.error('FAILED: validator should have run');
    process.exit(1);
  }

  console.log('PARALLEL CONVERGENCE TEST: OK');
}

main().catch(err => { console.error('PARALLEL CONVERGENCE TEST FAILED:', err); process.exit(1); });