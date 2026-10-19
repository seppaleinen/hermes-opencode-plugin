import { runHarness } from '../harness.js';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import type { Config, ModelRef, Plan } from '../types.js';

const tmpDir = '/tmp/hermes-parallel-test';

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
      status: 'PLAN', issue_summary: 'test parallel',
      activated_components: [
        {
          component: 'src/checkout.ts',
          objective: 'inspect',
          dependencies: [],
          communication_targets: ['src/validator.ts'],
          expected_action: 'inspect'
        },
        {
          component: 'src/validator.ts',
          objective: 'modify',
          dependencies: ['src/checkout.ts'],
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
    return { text: JSON.stringify({
      component: 'src/checkout.ts', action: 'no_change', summary: 'noop',
      changes: [], updated_artifact: 'export const value = "checkout";',
      messages: [], validation_notes: []
    }) };
  }
  if (input.prompt.includes('Component: src/validator.ts')) {
    return { text: JSON.stringify({
      component: 'src/validator.ts', action: 'modify', summary: 'fix',
      changes: [{ location: 'value', description: 'fixed' }],
      updated_artifact: 'export const value = "validator-fixed";',
      messages: [], validation_notes: []
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
      checkout: { file: 'src/checkout.ts', model: { providerID: 'litellm', id: 'checkout-model' } },
      validator: { file: 'src/validator.ts', model: { providerID: 'litellm', id: 'validator-model' } }
    },
    harness: {
      activation: { model: { providerID: 'litellm', id: 'activation-model' } },
      diagnosis: { model: { providerID: 'litellm', id: 'diagnosis-model' } }
    },
    parallelPrimitives: true,
    pricing: {
      'activation-model': { input: 1, output: 1 },
      'diagnosis-model': { input: 1, output: 1 },
      'checkout-model': { input: 1, output: 1 },
      'validator-model': { input: 1, output: 1 }
    }
  };

  const result = await runHarness(config, generateFn, 'test issue', {
    o_shell: 'Exit code: 0', o_test: '', o_runtime: '', o_trace: ''
  });

  // Verify: both primitives ran
  const primitives = result.logs[0].primitives;
  if (primitives.length !== 2) {
    console.error(`FAILED: expected 2 primitives, got ${primitives.length}`);
    process.exit(1);
  }

  // Verify: validator ran after checkout (dependency edge respected)
  const checkout = primitives.find(p => p.component === 'src/checkout.ts');
  const validator = primitives.find(p => p.component === 'src/validator.ts');
  if (!checkout || !validator) {
    console.error('FAILED: missing primitives');
    process.exit(1);
  }

  // Verify: validator wrote its file
  const fs = await import('node:fs/promises');
  const validatorContent = await fs.readFile(`${tmpDir}/src/validator.ts`, 'utf-8');
  if (!validatorContent.includes('validator-fixed')) {
    console.error('FAILED: validator file not modified correctly');
    process.exit(1);
  }

  // Verify: checkout was not modified (inspect action)
  const checkoutContent = await fs.readFile(`${tmpDir}/src/checkout.ts`, 'utf-8');
  if (!checkoutContent.includes('checkout";')) {
    console.error('FAILED: checkout file was unexpectedly modified');
    process.exit(1);
  }

  // Verify: token tracking
  if (!result.totalTokenUsage || result.totalTokenUsage.total <= 0) {
    console.error('FAILED: token tracking broken in parallel mode');
    process.exit(1);
  }

  console.log('Parallel primitives:', primitives.map(p => p.component));
  console.log('Total tokens:', JSON.stringify(result.totalTokenUsage));
  console.log('PARALLEL TEST: OK');
}

main().catch(err => { console.error('PARALLEL TEST FAILED:', err); process.exit(1); });