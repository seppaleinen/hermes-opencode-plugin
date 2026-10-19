import { runHarness } from '../harness.js';
import type { Config, ModelRef } from '../types.js';
import { mkdirSync, writeFileSync } from 'node:fs';

const tmpDir = '/tmp/hermes-token-test';
mkdirSync(`${tmpDir}/src`, { recursive: true });
mkdirSync(`${tmpDir}/test`, { recursive: true });
writeFileSync(`${tmpDir}/src/checkout.ts`, 'export const tmp = "checkout";');
writeFileSync(`${tmpDir}/src/validator.ts`, 'export const tmp = "validator";');
writeFileSync(`${tmpDir}/test/checkout.test.ts`, 'test');
writeFileSync(`${tmpDir}/package.json`, '{}');

let callCount = 0;
const generateFn = async (input: { prompt: string; model?: ModelRef }) => {
  callCount++;
  if (input.prompt.includes('You are the activation module')) {
    return { text: JSON.stringify({
      status: 'PLAN', issue_summary: 'test',
      activated_components: [
        { component: 'src/checkout.ts', objective: 'inspect', dependencies: [], communication_targets: [], expected_action: 'inspect' },
        { component: 'src/validator.ts', objective: 'modify', dependencies: [], communication_targets: [], expected_action: 'modify' }
      ],
      execution_plan: [], rationale: 'test'
    }) };
  }
  if (input.prompt.includes('You are the diagnosis module')) {
    return { text: JSON.stringify({ status: 'PASS', evidence: ['ok'], summary: 'pass' }) };
  }
  if (input.prompt.includes('Component: src/checkout.ts')) {
    return { text: JSON.stringify({ component: 'src/checkout.ts', action: 'no_change', summary: 'noop', changes: [], updated_artifact: 'export const tmp = "checkout";', messages: [], validation_notes: [] }) };
  }
  if (input.prompt.includes('Component: src/validator.ts')) {
    return { text: JSON.stringify({ component: 'src/validator.ts', action: 'modify', summary: 'fix', changes: [{ location: 'x', description: 'y' }], updated_artifact: 'export const tmp = "validator";', messages: [], validation_notes: [] }) };
  }
  return { text: '{}' };
};

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
  pricing: {
    'activation-model': { input: 1, output: 3 },
    'diagnosis-model': { input: 2, output: 4 },
    'checkout-model': { input: 5, output: 6 },
    'validator-model': { input: 7, output: 8 }
  }
};

async function main() {
  const result = await runHarness(config, generateFn, 'test issue', { o_shell: 'Exit code: 0', o_test: '', o_runtime: '', o_trace: '' });
  console.log('SUCCESS:', result.success);
  console.log('CALLS:', callCount);
  for (const log of result.logs) {
    console.log(`Round ${log.round}: tokenUsage=${JSON.stringify(log.tokenUsage)}, estimatedCost=${JSON.stringify(log.estimatedCost)}`);
    for (const p of log.primitives) {
      console.log(`  Primitive ${p.component}: tokenUsage=${JSON.stringify(p.tokenUsage)}`);
    }
  }
  console.log('TOTAL TOKENS:', JSON.stringify(result.totalTokenUsage));
  console.log('TOTAL COST:', JSON.stringify(result.estimatedCost));
  // Invariant checks
  const total = result.totalTokenUsage!;
  const roundSum = result.logs.reduce((a, l) => a + (l.tokenUsage?.total ?? 0), 0);
  // Total includes pre-round (initial activation) and post-round (replan
  // activation) calls that are not attributed to any round, so total >= roundSum.
  if (total.total < roundSum) throw new Error(`Total ${total.total} < round sum ${roundSum}`);
  if (total.input + total.output !== total.total) throw new Error('input+output != total');
  if (result.estimatedCost && result.estimatedCost.input + result.estimatedCost.output !== result.estimatedCost.total) throw new Error('cost input+output != total');
  console.log('TOKEN TEST: OK');
}

main().catch(err => { console.error('TOKEN TEST FAILED:', err); process.exit(1); });
