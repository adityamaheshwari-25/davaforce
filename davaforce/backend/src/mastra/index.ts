import { Mastra } from "@mastra/core";
import { workforceRouterAgent } from "./agents/workforce-router-agent";

export const mastra = new Mastra({
  agents: {
    workforceRouterAgent,
  },
});
