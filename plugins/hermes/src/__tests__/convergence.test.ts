import { MessageBus } from '../bus.js';
import { runHarness } from '../harness.js';
import type { Config, ModelRef, Plan } from '../types.js';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

// Minimal in-memory test to demonstrate within-round message convergence
// Using scripted GenerateFn with deterministic outputs.

async function testConvergence() {
  // Setup a temporary eval repo with checkout/validator files expected by harness
  const tmpDir = '/tmp/hermes-convergence-test';
  mkdirSync(`${tmpDir}/src`, { recursive: true });
  mkdirSync(`${tmpDir}/test`, { recursive: true });
  writeFileSync(`${tmpDir}/src/checkout.ts`, 'export const tmp = "checkout";');
  writeFileSync(`${tmpDir}/src/validator.ts`, 'export const tmp = "validator";');
  writeFileSync(`${tmpDir}/test/checkout.test.ts`, 'test');
  writeFileSync(`${tmpDir}/package.json`, '{}');

  // Scripted GenerateFn
  const generateFn = async (input: { prompt: string; model?: ModelRef }) => {
    const prompt = input.prompt;
    // Detect component
    if (prompt.includes('Component: src/checkout.ts')) {
      // Component A (checkout) checks incoming messages from validator
      const hasMsg = prompt.includes('From src/validator.ts to src/checkout.ts') && prompt.includes('signal=READY');
      const artifact = hasMsg ? `export const value = "checkout-coordinated";` : `export const value = "checkout-uncoordinated";`;
      return {
        text: JSON.stringify({
          component: 'src/checkout.ts',
          action: 'modify',
          summary: hasMsg ? 'Saw message from validator' : 'No message yet',
          changes: [{ location: 'value', description: hasMsg ? 'coordinated' : 'uncoordinated' }],
          updated_artifact: artifact,
          messages: [],
          validation_notes: []
        })
      };
    }
    if (prompt.includes('Component: src/validator.ts')) {
      // Component B (validator) always sends message to checkout
      return {
        text: JSON.stringify({
          component: 'src/validator.ts',
          action: 'modify',
          summary: 'Sending signal to checkout',
          changes: [{ location: 'value', description: 'sent signal' }],
          updated_artifact: 'export const value = "validator";',
          messages: [{ target: 'src/checkout.ts', message: 'signal=READY' }],
          validation_notes: []
        })
      };
    }
    // Activation / Diagnosis mock
    if (prompt.includes('You are the activation module')) {
      const plan: Plan = {
        status: 'PLAN',
        issue_summary: 'test coordination',
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
        execution_plan: [],
        rationale: 'test'
      };
      return { text: JSON.stringify(plan) };
    }
    if (prompt.includes('You are the diagnosis module')) {
      return {
        text: JSON.stringify({
          status: 'PASS',
          evidence: ['ok'],
          summary: 'pass'
        })
      };
    }
    return { text: '{}' };
  };

  const baseConfig: Config = {
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
    incompleteRound0: false,
  };

  // Test 1: single-pass with order B then A (misordering)
  // Expect A to be uncoordinated because it runs before B sends message
  const configSinglePass: Config = {
    ...baseConfig,
    intraRoundConvergence: false,
    __testComponentOrderOverride: ['src/checkout.ts', 'src/validator.ts'] // checkout runs first, misordering
  };

  const resultSingle = await runHarness(configSinglePass, generateFn, 'test issue', {
    o_shell: 'Exit code: 0',
    o_test: '',
    o_runtime: '',
    o_trace: ''
  });

  const aRunsSingle = resultSingle.logs[0].primitives.filter(p => p.component === 'src/checkout.ts');
  const aArtifactSingle = aRunsSingle[aRunsSingle.length - 1]?.result.updated_artifact || '';
  console.log('Single-pass A artifact:', aArtifactSingle);
  const singlePassCoordinated = aArtifactSingle.includes('checkout-coordinated');
  console.log('Single-pass coordinated?', singlePassCoordinated);

  // Test 2: intra-round convergence with same order
  const configConverge: Config = {
    ...baseConfig,
    intraRoundConvergence: true,
    __testComponentOrderOverride: ['src/checkout.ts', 'src/validator.ts'],
    __testMaxPassesPerComponent: 3
  };

  // Reset files
  writeFileSync(`${tmpDir}/src/checkout.ts`, 'export const value = "checkout";');
  writeFileSync(`${tmpDir}/src/validator.ts`, 'export const value = "validator";');

  const resultConverge = await runHarness(configConverge, generateFn, 'test issue', {
    o_shell: 'Exit code: 0',
    o_test: '',
    o_runtime: '',
    o_trace: ''
  });

  const aRunsConverge = resultConverge.logs[0].primitives.filter(p => p.component === 'src/checkout.ts');
  const aArtifactConverge = aRunsConverge[aRunsConverge.length - 1]?.result.updated_artifact || '';
  console.log('Converge A artifact:', aArtifactConverge);
  const convergeCoordinated = aArtifactConverge.includes('checkout-coordinated');
  console.log('Converge coordinated?', convergeCoordinated);

  // Assertions
  if (singlePassCoordinated) {
    console.error('RED GATE FAILED: single-pass unexpectedly coordinated');
    process.exit(1);
  }
  if (!convergeCoordinated) {
    console.error('RED GATE FAILED: convergence did not coordinate');
    process.exit(1);
  }
  console.log('RED GATE DEMONSTRATED: single-pass fails, convergence succeeds');
  console.log('SUCCESS');
}

testConvergence().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
