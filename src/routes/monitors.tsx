import { createFileRoute } from "@tanstack/react-router";
import { MonitorsPage } from "@/features/monitors/monitors-page";

export const Route = createFileRoute("/monitors")({
  component: MonitorsPage,
});
