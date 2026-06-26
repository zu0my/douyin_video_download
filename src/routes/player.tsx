import { createFileRoute } from "@tanstack/react-router";
import { VideoPlayerPage } from "@/features/videos/video-player-page";

export const Route = createFileRoute("/player")({
  validateSearch: (search: Record<string, unknown>) => ({
    id: typeof search.id === "string" ? search.id : "",
  }),
  component: PlayerRoute,
});

function PlayerRoute() {
  const { id } = Route.useSearch();
  return <VideoPlayerPage videoId={id} />;
}
