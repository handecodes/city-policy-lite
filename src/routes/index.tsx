import { createFileRoute } from "@tanstack/react-router";
import { CrashTest } from "@/components/crash/CrashTest";

const DESC = "An AI agent that stress-tests a city traffic policy in simulation and shows where the traffic goes.";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "City Policy Crash-Test" },
      { name: "description", content: DESC },
      { property: "og:title", content: "City Policy Crash-Test" },
      { property: "og:description", content: DESC },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CrashTest,
});
