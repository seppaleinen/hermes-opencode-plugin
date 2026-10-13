import { Plugin } from "@opencode/plugin";
import type { Config, ModelRef } from "./src/types.js";

type GenerateFn = (input: { prompt: string; model?: ModelRef }) => Promise<{ text: string }>;

const DEFAULT_CONFIG: Config = {
  evalRepo: "./eval",
  budget: { B: 1 },
  components: {
    validator: { 
      file: "src/validator.ts", 
      model: { providerID: "litellm", id: "qwen3-8b" } 
    },
    checkout: { 
      file: "src/checkout.ts", 
      model: { providerID: "litellm", id: "llama-3.1-8b-instruct" } 
    }
  },
  harness: {
    activation: { model: { providerID: "opencode", id: "ling-3.1-flash-free" } },
    diagnosis: { model: { providerID: "opencode", id: "ling-3.1-flash-free" } }
  }
};

export default Plugin.define({
  id: "hermes",
  async setup(ctx) {
    const config = ctx.options as Config || DEFAULT_CONFIG;

    // Register activation as a tool
    await ctx.tool.transform((editor) => {
      editor.namespace({ name: "hermes", description: "HERMES mechanism" });
      
      editor.add({
        name: "activate",
        description: "Run the HERMES activation module",
        input: {
          type: "object",
          properties: {
            issue: { type: "string" },
            repoStructure: { type: "string" },
            repoContext: { type: "string" }
          },
          required: ["issue"]
        },
        async execute(input, context) {
          const { activate } = await import("./src/activation.js");
          const result = await activate(
            input.issue,
            input.repoStructure || "",
            input.repoContext || "",
            null,
            null,
            ctx.generate.text.bind(ctx.generate),
            config.harness.activation.model
          );
          return { content: JSON.stringify(result, null, 2) };
        }
      });

      editor.add({
        name: "try_run_hermes",
        description: "Run full HERMES prototype against eval repo",
        input: {
          type: "object",
          properties: {
            issue: { type: "string" },
            cycle: { type: "number", default: 1 }
          },
          required: ["issue"]
        },
        async execute(input, context) {
          const { runHarness } = await import("./src/harness.js");
          
          // Prepare manifest for evidence buckets
          const manifest = {
            evalRepo: config.evalRepo,
            budget: config.budget.B
          };
          
          const result = await runHarness(
            config,
            ctx.generate.text.bind(ctx.generate),
            input.issue,
            { o_shell: "", o_test: "", o_runtime: "", o_trace: "" }
          );
          
          return { 
            content: JSON.stringify({
              success: result.success,
              cycle: input.cycle,
              finalDiagnosis: result.finalDiagnosis,
              logs: result.logs.map(l => ({
                round: l.round,
                verdict: l.diagnosis?.verdict,
                testResults: l.execution ? {
                  exitCode: extractExitCode(l.execution.o_shell),
                  testOutput: l.execution.o_test
                } : null
              }))
            }, null, 2) 
          };
        }
      });
    });
  },
});

function extractExitCode(output: string): number {
  const match = output.match(/Exit code:\s*(\d+)/);
  return match ? parseInt(match[1]) : -1;
}
