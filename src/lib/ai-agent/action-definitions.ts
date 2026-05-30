import type { FunctionDefinition } from "./llm-providers/types";

export const availableFunctions: FunctionDefinition[] = [
  {
    name: "propose_run_plan",
    description: "Propose running the planning algorithm for all pending unassigned jobs.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "propose_assign_driver",
    description: "Propose manually assigning a driver to a job. Use the job reference (Load #) and driver name.",
    parameters: {
      type: "object",
      properties: {
        job_reference: { type: "string", description: "Job reference / Load # e.g. 114KBDG83" },
        driver_name: { type: "string", description: "Driver full or partial name" },
      },
      required: ["job_reference", "driver_name"],
    },
  },
];
