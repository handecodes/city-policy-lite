import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "City Policy Crash-Test" },
      { name: "description", content: "City Policy Crash-Test — frontend coming from GitHub." },
      { property: "og:title", content: "City Policy Crash-Test" },
      { property: "og:description", content: "City Policy Crash-Test — frontend coming from GitHub." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-2 bg-background p-6 text-center">
      <h1 className="text-3xl font-semibold text-foreground">City Policy Crash-Test</h1>
      <p className="text-muted-foreground">Frontend coming from GitHub</p>
    </main>
  );
}
