import { createFileRoute } from "@tanstack/react-router";
import { VideosPage } from "@/features/videos/videos-page";

export const Route = createFileRoute("/videos")({
  component: VideosPage,
});
