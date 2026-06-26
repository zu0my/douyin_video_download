import { createFileRoute } from "@tanstack/react-router";
import { CookiesPage } from "@/features/cookies/cookies-page";

export const Route = createFileRoute("/cookies")({
  component: CookiesPage,
});
