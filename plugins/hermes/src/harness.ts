import { readFile } from 'node:fs/promises';
import { Config, ModelRef, Plan, Message, Evidence, DiagnosisOutput, DevPrimitiveOutput, RetainedModifications, TokenUsage, TokenCostEstimate, GenerateFn, GenerateResult, ActivatedComponent } from "./types.js";
import { MessageBus } from "./bus.js";
import { activate } from "./activation.js";
import { collaborate } from "./collaborate.js";
import { execute } from "./execute.js";
import { diagnose, gateOnTestEvidence, DiagnosisResult } from "./diagnose.js";

/**
 * The generate function signature matches OpenCode's `ctx.generate.text`:
 * `GenerateTextOutput = { text: string }` (no usage field, see
 * docs/opencode-plugin-sdk-reference.md §3a). Token usage is therefore
 * estimated from prompt/response string lengths when the host does not
 * expose it. (issue #19)
 */

/**
 * Per-component token usage recorded alongside a Dev-Primitive result.
 * `component` is the repository path (e.g. "src/validator.ts"); `model` is the
 * model that produced the output. The `usage` is the raw token count for this
 * single call.
 */
export interface PrimitiveLogEntry {
  component: string;
  model: ModelRef;
  result: DevPrimitiveOutput;
  tokenUsage?: TokenUsage;
}

export interface HarnessLog {
  round: number;
  activation?: { model: ModelRef; result: Plan };
  /** T6: the activation plan as received at the top of this round (verbatim). */
  _activationPlan?: Plan;
  /** T6: whether the controlled round-0 incomplete constraint was active. */
  _roundConstraintActive?: boolean;
  primitives: PrimitiveLogEntry[];
  messages: Message[];
  execution?: Evidence;
  diagnosis?: DiagnosisResult;
  /** Retained modifications after this round (issue #17). */
  retainedModifications?: RetainedModifications;
  /**
   * Token usage accumulated during this round's model calls (activation +
   * primitives + diagnosis). Absent when the round made no model calls.
   */
  tokenUsage?: TokenUsage;
  /** Estimated cost for this round's token usage. Absent when no pricing is known. */
  estimatedCost?: TokenCostEstimate | null;
}

export interface HarnessResult {
  success: boolean;
  logs: HarnessLog[];
  finalEvidence: Evidence | null;
  finalDiagnosis: DiagnosisResult | null;
  /** All retained modifications accumulated across rounds (issue #17). */
  retainedModifications?: RetainedModifications;
  /** Token usage accumulated across all rounds (issue #19). */
  totalTokenUsage?: TokenUsage;
  /** Estimated cost for the full trajectory (issue #19). */
  estimatedCost?: TokenCostEstimate | null;
}

function extractExitCode(output: string): number {
  const match = output.match(/Exit code:\s*(\d+)/);
  return match ? parseInt(match[1]) : -1;
}

/**
 * Only source files under src/ are eligible for Dev-Primitive collaboration.
 * Test files and package.json are ground truth / config — never modified.
 */
function isEligibleComponent(component: string): boolean {
  return component.startsWith("src/") && component.endsWith(".ts");
}

/**
 * Resolve the per-component model from config.
 *
 * config.components is keyed by bare component name ("validator", "checkout")
 * while plan.activated_components[].component carries the repository path
 * ("src/validator.ts"). Without this normalization the lookup always misses
 * and silently falls back to the activation model — i.e. the declared
 * per-component heterogeneity is never exercised. (T6 finding: all three
 * prior runs logged freellmapi for every call despite the config.)
 */
function componentModel(config: Config, component: string): ModelRef {
  const key = component.replace(/^src\//, "").replace(/\.ts$/, "");
  return config.components[key]?.model || config.harness.activation.model;
}

/**
 * Tracks token usage for model calls across a trajectory, providing per-round
 * and cumulative token counts and estimated cost. Token usage is extracted from
 * the `usage` field returned by `GenerateFn` when available; otherwise it is
 * estimated from prompt/response string lengths (≈1 token per 4 chars). (issue #19)
 */
class TokenTracker {
  private roundUsage = { input: 0, output: 0, total: 0 } as TokenUsage;
  private totalUsage = { input: 0, output: 0, total: 0 } as TokenUsage;
  private roundModels = new Map<string, TokenUsage>();
  private totalModels = new Map<string, TokenUsage>();
  private componentUsage = new Map<string, TokenUsage>();
  private lastCallUsage: TokenUsage | null = null;

  constructor(private config: Config) {
  }

  /** Wrap a GenerateFn to intercept calls and record token usage. */
  wrap(generateFn: GenerateFn): GenerateFn {
    const tracker = this;
    return async (input: { prompt: string; model?: ModelRef }): Promise<GenerateResult> => {
      const result = await generateFn(input);
      const usage = tracker.recordUsage(result, input);
      return { ...result, usage };
    };
  }

  /** Wrap a GenerateFn for a specific component, recording its token usage separately. */
  wrapForComponent(component: string, generateFn: GenerateFn): GenerateFn {
    const tracker = this;
    return async (input: { prompt: string; model?: ModelRef }): Promise<GenerateResult> => {
      const result = await generateFn(input);
      const usage = result.usage ?? estimateUsage(input.prompt, result.text);
      // Accumulate (a component may run multiple passes within a round)
      const current = tracker.componentUsage.get(component) || { input: 0, output: 0, total: 0 };
      current.input += usage.input;
      current.output += usage.output;
      current.total += usage.total;
      tracker.componentUsage.set(component, current);
      return { ...result, usage };
    };
  }

  /** Record token usage from a generate call and update accumulators. */
  private recordUsage(result: GenerateResult, input: { prompt: string; model?: ModelRef }): TokenUsage {
    const usage = result.usage ?? estimateUsage(input.prompt, result.text);
    if (input.model?.id) {
      this.roundUsage.input += usage.input;
      this.roundUsage.output += usage.output;
      this.roundUsage.total += usage.total;
      this.totalUsage.input += usage.input;
      this.totalUsage.output += usage.output;
      this.totalUsage.total += usage.total;
      this.accumulateModel(this.roundModels, this.totalModels, input.model.id, usage);
    }
    this.lastCallUsage = usage;
    return { ...usage };
  }

  /** Take and clear the usage of the most recent generate call. */
  takeLastUsage(): TokenUsage | null {
    const u = this.lastCallUsage;
    this.lastCallUsage = null;
    return u;
  }

  private accumulateModel(
    roundMap: Map<string, TokenUsage>,
    totalMap: Map<string, TokenUsage>,
    modelId: string,
    usage: TokenUsage
  ): void {
    const currentRound = roundMap.get(modelId) || { input: 0, output: 0, total: 0 };
    currentRound.input += usage.input;
    currentRound.output += usage.output;
    currentRound.total += usage.total;
    roundMap.set(modelId, currentRound);

    const currentTotal = totalMap.get(modelId) || { input: 0, output: 0, total: 0 };
    currentTotal.input += usage.input;
    currentTotal.output += usage.output;
    currentTotal.total += usage.total;
    totalMap.set(modelId, currentTotal);
  }

  /** Return token usage accumulated for the current round and reset accumulators. */
  flushRound(): TokenUsage {
    const usage = { ...this.roundUsage };
    this.roundUsage = { input: 0, output: 0, total: 0 };
    this.roundModels.clear();
    return usage;
  }

  /** Return cumulative token usage across all rounds. */
  getTotalUsage(): TokenUsage {
    let input = 0, output = 0, total = 0;
    for (const u of this.totalModels.values()) {
      input += u.input;
      output += u.output;
      total += u.total;
    }
    return { input, output, total };
  }

  /** Estimate cost for a given usage against per-model pricing. Returns null if any model is unpriced. */
  estimateCost(usage: TokenUsage, modelId: string): TokenCostEstimate | null {
    const pricing = this.config.pricing?.[modelId];
    if (!pricing) return null;
    const inputCost = (usage.input / 1_000_000) * pricing.input;
    const outputCost = (usage.output / 1_000_000) * pricing.output;
    return {
      input: inputCost,
      output: outputCost,
      total: inputCost + outputCost,
      currency: pricing.currency || "USD",
    };
  }

  /** Estimate total trajectory cost. Returns null if any model is unpriced. */
  totalCost(): TokenCostEstimate | null {
    let input = 0, output = 0;
    let currency = "USD";
    for (const [modelId, usage] of this.totalModels) {
      const price = this.config.pricing?.[modelId];
      if (!price) return null;
      input += (usage.input / 1_000_000) * price.input;
      output += (usage.output / 1_000_000) * price.output;
      currency = price.currency || "USD";
    }
    const total = input + output;
    return { input, output, total, currency };
  }

  /** Estimate cost for the current round. Returns null if any model used is unpriced. */
  roundCost(): TokenCostEstimate | null {
    let input = 0, output = 0;
    let currency = "USD";
    for (const [modelId, usage] of this.roundModels) {
      const price = this.config.pricing?.[modelId];
      if (!price) return null;
      input += (usage.input / 1_000_000) * price.input;
      output += (usage.output / 1_000_000) * price.output;
      currency = price.currency || "USD";
    }
    const total = input + output;
    return { input, output, total, currency };
  }

  /** Take token usage for a specific component (used by parallel scheduler). */
  takeComponentUsage(component: string): TokenUsage | null {
    const usage = this.componentUsage.get(component);
    if (!usage) return null;
    this.componentUsage.delete(component);
    return { ...usage };
  }
}

/**
 * Rough token estimate: ≈4 chars per token.
 */
function estimateUsage(prompt: string, response: string): TokenUsage {
  const input = Math.max(0, Math.ceil((prompt?.length || 0) / 4));
  const output = Math.max(0, Math.ceil((response?.length || 0) / 4));
  return { input, output, total: input + output };
}

/**
 * Minimal async mutex for serializing file writes across concurrent
 * primitives. Per-component instances prevent two concurrent `collaborate`
 * calls from writing to the same artifact file simultaneously.
 */
export class AsyncMutex {
  private queue: Array<() => void> = [];
  private locked = false;

  async acquire(): Promise<void> {
    if (!this.locked) {
      this.locked = true;
      return;
    }
    await new Promise<void>(resolve => this.queue.push(resolve));
  }

  release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.locked = false;
    }
  }

  async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}

/**
 * Build the dependency DAG from the plan's activated components.
 * Returns a map of component -> set of components that depend on it (reverse deps),
 * plus the in-degree of each component (how many of its declared deps are active).
 */
function buildDependencyGraph(comps: ActivatedComponent[]): {
  dependents: Map<string, string[]>;
  indegree: Map<string, number>;
} {
  const activeSet = new Set(comps.map(c => c.component));
  const dependents = new Map<string, string[]>();
  const indegree = new Map<string, number>();

  // Pass 1: register every component (so reverse edges can be added even
  // when the dependent component is processed before its dependency).
  for (const comp of comps) {
    dependents.set(comp.component, []);
    indegree.set(comp.component, 0);
  }

  // Pass 2: compute indegree and build reverse edges.
  for (const comp of comps) {
    for (const dep of comp.dependencies || []) {
      if (activeSet.has(dep)) {
        indegree.set(comp.component, (indegree.get(comp.component) ?? 0) + 1);
        dependents.get(dep)!.push(comp.component);
      }
    }
  }

  return { dependents, indegree };
}

/**
 * Sort a list of ready components deterministically:
 * - components named in `orderOverride` come first, in override order;
 * - the rest follow alphabetically.
 */
function sortReadyQueue(
  ready: ActivatedComponent[],
  orderOverride?: string[]
): ActivatedComponent[] {
  const orderMap = new Map<string, number>();
  if (orderOverride) {
    for (const [i, c] of orderOverride.entries()) orderMap.set(c, i);
  }
  return [...ready].sort((a, b) => {
    const ia = orderMap.get(a.component) ?? Number.MAX_SAFE_INTEGER;
    const ib = orderMap.get(b.component) ?? Number.MAX_SAFE_INTEGER;
    if (ia !== ib) return ia - ib;
    return a.component < b.component ? -1 : a.component > b.component ? 1 : 0;
  });
}

/**
 * Schedule and run independent primitives concurrently based on the
 * dependency DAG from plan.activated_components.
 *
 * - Ready components (all active deps completed) launch concurrently;
 * - launch order is deterministic (override order, then alphabetical);
 * - when a primitive finishes, its out-messages may unblock dependents
 *   (or mark components with new unread messages as re-runnable, capped
 *   by maxPasses);
 * - each component writes through its own AsyncMutex (per-component lock).
 */
async function scheduleParallel(
  comps: ActivatedComponent[],
  config: Config,
  evalRepo: string,
  issue: string,
  round: number,
  bus: MessageBus,
  activeComponents: Set<string>,
  trackedGenerateFn: GenerateFn,
  tracker: TokenTracker,
  log: HarnessLog,
  maxPasses: number
): Promise<void> {
  const { dependents, indegree } = buildDependencyGraph(comps);
  const compByPath = new Map(comps.map(c => [c.component, c]));
  const mutexes = new Map<string, AsyncMutex>();
  const running = new Map<string, Promise<DevPrimitiveOutput>>();
  const passCount = new Map<string, number>();
  const ready = new Map<string, ActivatedComponent>();
  /**
   * Components whose dependents have already been unblocked (first
   * completion only). Re-running a component (convergence pass) must NOT
   * decrement dependents' indegree a second time.
   */
  const unblocked = new Set<string>();
  /**
   * Per-component read watermark maintained by the SCHEDULER (not the bus):
   * the inbox length observed by each component's last pass. A component is
   * re-runnable only when the bus holds MORE messages than its watermark.
   * Keeping the pointer here (not in the bus's shared `readPointers`) is
   * race-free: messages delivered by an in-flight pass are counted for the
   * NEXT pass, but the bus pointer must not advance behind an in-flight pass.
   */
  const watermarks = new Map<string, number>();

  const getMutex = (component: string): AsyncMutex => {
    let m = mutexes.get(component);
    if (!m) {
      m = new AsyncMutex();
      mutexes.set(component, m);
    }
    return m;
  };

  const hasNewMessages = (component: string): boolean => {
    const wm = watermarks.get(component) ?? 0;
    return bus.inboxLength(component) > wm;
  };

  const launch = (comp: ActivatedComponent) => {
    ready.delete(comp.component);
    const model = componentModel(config, comp.component);
    const componentGenerateFn = tracker.wrapForComponent(comp.component, trackedGenerateFn);
    const mutex = getMutex(comp.component);

    const promise = (async () => {
      // Hold the lock across read + generate + write so a concurrent re-run
      // for the same component cannot interleave with an in-flight pass
      // (write-ordering guarantee: each component's artifact file is only
      // ever written by its own primitive, serialized through this mutex).
      return mutex.runExclusive(async () => {
        const incomingMessages = bus.getMessagesFor(comp.component);
        // Snapshot the watermark AFTER this pass's snapshot of the inbox:
        // messages delivered by OTHER in-flight primitives after this
        // snapshot are exactly the ones that should re-activate us.
        const watermark = bus.inboxLength(comp.component);
        const dependencyContext = `Dependencies: ${(comp.dependencies || []).join(', ') || 'none'}`;
        const result = await collaborate(
          comp.component,
          `${evalRepo}/${comp.component}`,
          comp.objective,
          issue,
          incomingMessages,
          dependencyContext,
          componentGenerateFn,
          model,
          bus,
          round,
          config.incompleteRound0 === true,
          comp.expected_action
        );
        // Advance only if no other (later) pass has already advanced it.
        const prev = watermarks.get(comp.component) ?? 0;
        if (watermark >= prev) watermarks.set(comp.component, watermark);
        return result;
      });
    })();

    running.set(comp.component, promise);
  };

  const processResult = (comp: ActivatedComponent, result: DevPrimitiveOutput) => {
    log.primitives.push({
      component: comp.component,
      model: componentModel(config, comp.component),
      result,
      tokenUsage: tracker.takeComponentUsage(comp.component) || undefined,
    });

    // Handle messages to non-active targets
    for (const msg of result.messages || []) {
      if (!activeComponents.has(msg.target)) {
        bus.queueForNextRound(msg.target, {
          source: comp.component,
          target: msg.target,
          type: "dependency",
          message: msg.message,
          required_action: "review"
        });
      }
    }
  };

  const unblockDependents = (comp: ActivatedComponent) => {
    // Only the FIRST completion of a component unblocks dependents:
    // dependents need their dependency's artifact to be written once.
    // Subsequent (convergence) passes re-activate dependents via the
    // message path, not via the DAG.
    if (unblocked.has(comp.component)) return;
    unblocked.add(comp.component);
    for (const dep of dependents.get(comp.component) || []) {
      // Never DAG-unblock a component that has already run (its first pass
      // was triggered by a message, not by the DAG).
      if ((passCount.get(dep) ?? 0) > 0) continue;
      const deg = indegree.get(dep) ?? 0;
      if (deg <= 1) {
        indegree.set(dep, 0);
        if (!running.has(dep)) {
          const target = compByPath.get(dep);
          if (target) ready.set(dep, target);
        }
      } else {
        indegree.set(dep, deg - 1);
      }
    }
  };

  const maybeScheduleReruns = () => {
    // Paper F.5: a component that receives new messages is re-activated
    // promptly within the same round, capped by maxPasses.
    for (const activeComp of activeComponents) {
      const target = compByPath.get(activeComp);
      if (!target) continue;
      const passes = passCount.get(activeComp) ?? 0;
      if (passes >= maxPasses) continue;
      if (running.has(activeComp)) continue;
      if (ready.has(activeComp)) continue;
      if (hasNewMessages(activeComp)) {
        ready.set(activeComp, target);
      }
    }
  };

  // Seed the ready set with all initially-ready components (no active deps).
  for (const comp of comps) {
    if ((indegree.get(comp.component) ?? 0) === 0) {
      ready.set(comp.component, comp);
    }
  }
  /**
   * Cycle-break fallback: the activation module should never produce a
   * dependency cycle, but if one is declared the scheduler would stall with
   * blocked-but-unstarted components. Break it deterministically by launching
   * the alphabetically-first unstarted component (its indegree is ignored at
   * launch); the first completion then unblocks the rest of the cycle.
   */
  const breakCycle = () => {
    const unstarted = [...compByPath.keys()]
      .filter(c => (passCount.get(c) ?? 0) === 0 && !running.has(c) && !ready.has(c))
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    if (unstarted.length === 0) return;
    const comp = compByPath.get(unstarted[0])!;
    indegree.set(comp.component, 0);
    ready.set(comp.component, comp);
  };

  while (true) {
    // Launch all ready components in deterministic order.
    if (ready.size > 0) {
      for (const comp of sortReadyQueue([...ready.values()], config.__testComponentOrderOverride)) {
        passCount.set(comp.component, (passCount.get(comp.component) ?? 0) + 1);
        launch(comp); // launch removes the component from `ready`
      }
    }

    // Quiescence check: nothing running and nothing left to launch.
    if (running.size === 0) {
      const unstarted = [...compByPath.keys()].filter(c => (passCount.get(c) ?? 0) === 0);
      if (unstarted.length > 0) {
        breakCycle();
        continue; // re-loop and launch the cycle-broken component
      }
      break; // true quiescence: every component has run at least once
    }

    // Wait for the first in-flight primitive to finish.
    const settled = await Promise.race([
      ...[...running.entries()].map(
        ([name, p]) => p.then(
          r => ({ name, result: r, error: null }),
          e => ({ name, result: null, error: e })
        )
      )
    ]);

    running.delete(settled.name);
    const comp = compByPath.get(settled.name)!;

    if (settled.error) {
      // Propagate the first failure; other in-flight passes continue in the
      // background (they may already have written their artifacts) but their
      // results are discarded.
      throw settled.error;
    }

    processResult(comp, settled.result!);

    // Unblock DAG dependents (first completion only) and scan for
    // re-runnable components whose inbox grew.
    unblockDependents(comp);
    maybeScheduleReruns();
  }
}

export async function runHarness(
  config: Config,
  generateFn: GenerateFn,
  issue: string,
  baselineEvidence: Evidence
): Promise<HarnessResult> {
  const logs: HarnessLog[] = [];
  const evalRepo = config.evalRepo;
  const B = config.budget.B;

  const checkoutContent = await readFile(`${evalRepo}/src/checkout.ts`, 'utf-8');
  const validatorContent = await readFile(`${evalRepo}/src/validator.ts`, 'utf-8');

  const repoStructure = `src/checkout.ts\nsrc/validator.ts\ntest/checkout.test.ts\npackage.json`;

  // Track successful modifications across rounds (issue #17)
  let retainedModifications: RetainedModifications = {};

  // Token/cost tracking (issue #19)
  const tracker = new TokenTracker(config);
  const trackedGenerateFn = tracker.wrap(generateFn);

  const registeredArtifacts = new Set<string>();

  let plan = await activate(
    issue,
    repoStructure,
    `src/checkout.ts:\n\`\`\`\n${checkoutContent}\n\`\`\`\n\nsrc/validator.ts:\n\`\`\`\n${validatorContent}\n\`\`\``,
    null,
    null,
    trackedGenerateFn,
    config.harness.activation.model,
    retainedModifications,
    registeredArtifacts
  );

  let previousFeedback = null;

  for (let b = 0; b <= B; b++) {
    const log: HarnessLog = { round: b, primitives: [], messages: [] };
    log.activation = {
      model: config.harness.activation.model,
      result: plan,
    };

    const bus = new MessageBus();
    const activeComponents = new Set<string>();
    for (const comp of plan.activated_components) {
      if (isEligibleComponent(comp.component)) {
        activeComponents.add(comp.component);
      }
    }
    // Merge registered artifacts (created in prior rounds) into active set
    for (const f of registeredArtifacts) {
      if (isEligibleComponent(f)) {
        activeComponents.add(f);
      }
    }

    log.primitives = [];

    // Log the activation plan for this round verbatim
    log._activationPlan = plan;
    log._roundConstraintActive = (config.incompleteRound0 === true && b === 0);

    // Prepare eligible components with optional test order override
    let comps = plan.activated_components.filter(c => isEligibleComponent(c.component));
    if (config.__testComponentOrderOverride) {
      const orderMap = new Map(config.__testComponentOrderOverride.map((c, i) => [c, i]));
      comps = [...comps].sort((a, b) => {
        const ia = orderMap.has(a.component) ? orderMap.get(a.component)! : Number.MAX_SAFE_INTEGER;
        const ib = orderMap.has(b.component) ? orderMap.get(b.component)! : Number.MAX_SAFE_INTEGER;
        return ia - ib;
      });
    }

    const intraRound = config.intraRoundConvergence === true;
    const maxPasses = config.__testMaxPassesPerComponent ?? 3;

    if (config.parallelPrimitives === true) {
      // Parallel primitive execution: schedule independent primitives
      // concurrently based on the dependency DAG from plan.activated_components.
      await scheduleParallel(
        comps,
        config,
        evalRepo,
        issue,
        b,
        bus,
        activeComponents,
        trackedGenerateFn,
        tracker,
        log,
        maxPasses
      );
    } else if (!intraRound) {
      // Sequential single-pass collaboration — only eligible source components (baseline behavior)
      for (const comp of comps) {
        const incomingMessages = bus.getMessagesFor(comp.component);
        const dependencyContext = `Dependencies: ${comp.dependencies.join(', ') || 'none'}`;

        const result = await collaborate(
          comp.component,
          `${evalRepo}/${comp.component}`,
          comp.objective,
          issue,
          incomingMessages,
          dependencyContext,
          trackedGenerateFn,
          componentModel(config, comp.component),
          bus,
          b,
          config.incompleteRound0 === true,
          comp.expected_action
        );

        log.primitives.push({
          component: comp.component,
          model: componentModel(config, comp.component),
          result,
          tokenUsage: tracker.takeLastUsage() || undefined,
        });

        // Handle messages to non-active targets
        for (const msg of result.messages || []) {
          if (!activeComponents.has(msg.target)) {
            bus.queueForNextRound(msg.target, {
              source: comp.component,
              target: msg.target,
              type: "dependency",
              message: msg.message,
              required_action: "review"
            });
          }
        }
      }
    } else {
      // Intra-round convergence loop
      const componentPassCount = new Map<string, number>();
      const queue: typeof comps = [...comps];
      // Mark initial read pointers to avoid re-processing old messages
      for (const comp of comps) {
        bus.markRead(comp.component);
      }

      while (queue.length > 0) {
        const comp = queue.shift()!;
        const passes = componentPassCount.get(comp.component) ?? 0;
        if (passes >= maxPasses) continue;

        const incomingMessages = bus.getMessagesFor(comp.component);
        const dependencyContext = `Dependencies: ${comp.dependencies.join(', ') || 'none'}`;

        const result = await collaborate(
          comp.component,
          `${evalRepo}/${comp.component}`,
          comp.objective,
          issue,
          incomingMessages,
          dependencyContext,
          trackedGenerateFn,
          componentModel(config, comp.component),
          bus,
          b,
          config.incompleteRound0 === true,
          comp.expected_action
        );

        log.primitives.push({
          component: comp.component,
          model: componentModel(config, comp.component),
          result,
          tokenUsage: tracker.takeLastUsage() || undefined,
        });

        componentPassCount.set(comp.component, passes + 1);

        // Handle messages to non-active targets
        for (const msg of result.messages || []) {
          if (!activeComponents.has(msg.target)) {
            bus.queueForNextRound(msg.target, {
              source: comp.component,
              target: msg.target,
              type: "dependency",
              message: msg.message,
              required_action: "review"
            });
          }
        }

        // Schedule re-runs for components with unread messages
        for (const activeComp of activeComponents) {
          if (bus.hasUnread(activeComp)) {
            const targetComp = comps.find(c => c.component === activeComp);
            if (targetComp) {
              const targetPasses = componentPassCount.get(activeComp) ?? 0;
              if (targetPasses < maxPasses && !queue.some(c => c.component === activeComp)) {
                queue.push(targetComp);
              }
            }
            // Mark as read after scheduling to avoid re-scheduling same batch repeatedly
            bus.markRead(activeComp);
          }
        }
      }
    }

    // Collect created artifacts from this round's primitives
    for (const primitive of log.primitives) {
      for (const file of primitive.result.createdArtifacts || []) {
        registeredArtifacts.add(file);
      }
    }

    // Collect all bus messages
    log.messages = bus.getAllMessages();

    // Execute
    const evidence = await execute(evalRepo);
    log.execution = evidence;

    const exitCode = extractExitCode(evidence.o_shell);

    // Diagnose
    const diagnosis = await diagnose(
      issue,
      plan,
      plan.activated_components.map(c => c.component),
      evidence,
      exitCode,
      previousFeedback,
      trackedGenerateFn,
      config.harness.diagnosis.model
    );
    log.diagnosis = diagnosis;

    // Track successful modifications from this round (issue #17)
    // A modification is "successful" if the round's gate passed (tests pass, no regressions)
    if (diagnosis.gate.gatePassed) {
      for (const primitive of log.primitives) {
        if (primitive.result.action === "modify" && primitive.result.updated_artifact) {
          const filePath = primitive.component;
          retainedModifications[filePath] = {
            filePath,
            content: primitive.result.updated_artifact,
            round: b,
            reason: `gate passed (exit code ${exitCode}, 0 failing tests)`,
          };
        }
      }
    }

    // Record retained modifications in the log
    log.retainedModifications = { ...retainedModifications };

    // Token/cost tracking: record round totals (issue #19)
    const roundCost = tracker.roundCost();
    const roundUsage = tracker.flushRound();
    if (roundUsage.total > 0) {
      log.tokenUsage = roundUsage;
      log.estimatedCost = roundCost;
    }

    logs.push(log);

    if (diagnosis.verdict === "pass") {
      const totalUsage = tracker.getTotalUsage();
      const totalCost = tracker.totalCost();
      return {
        success: true,
        logs,
        finalEvidence: evidence,
        finalDiagnosis: diagnosis,
        retainedModifications,
        totalTokenUsage: totalUsage,
        estimatedCost: totalCost,
      };
    }

    // Prepare for next revision round
    previousFeedback = JSON.stringify(diagnosis.modelVerdict, null, 2);

    const newCheckoutContent = await readFile(`${evalRepo}/src/checkout.ts`, 'utf-8');
    const newValidatorContent = await readFile(`${evalRepo}/src/validator.ts`, 'utf-8');

    plan = await activate(
      issue,
      repoStructure,
      `src/checkout.ts:\n\`\`\`\n${newCheckoutContent}\n\`\`\`\n\nsrc/validator.ts:\n\`\`\`\n${newValidatorContent}\n\`\`\``,
      plan,
      previousFeedback,
      trackedGenerateFn,
      config.harness.activation.model,
      retainedModifications,
      registeredArtifacts
    );
  }

  const finalLog = logs[logs.length - 1];
  const totalUsage = tracker.getTotalUsage();
  const totalCost = tracker.totalCost();
  return {
    success: false,
    logs,
    finalEvidence: finalLog?.execution || null,
    finalDiagnosis: finalLog?.diagnosis || null,
    retainedModifications,
    totalTokenUsage: totalUsage,
    estimatedCost: totalCost,
  };
}
