import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

export async function openVideoPlayer(videoId: string, title: string) {
  const label = `player-${videoId}-${Date.now()}`.replace(
    /[^a-zA-Z0-9-]/g,
    "-",
  );
  const window = new WebviewWindow(label, {
    url: `/#/player?id=${encodeURIComponent(videoId)}`,
    title: title || "作品浏览",
    width: 980,
    height: 720,
    minWidth: 720,
    minHeight: 520,
    resizable: true,
    decorations: false,
    shadow: false,
    center: true,
  });

  await new Promise<void>((resolve, reject) => {
    const unlistenCreated = window.once("tauri://created", () => {
      void unlistenCreated.then((unlisten) => unlisten());
      void unlistenError.then((unlisten) => unlisten());
      resolve();
    });
    const unlistenError = window.once("tauri://error", (event) => {
      void unlistenCreated.then((unlisten) => unlisten());
      void unlistenError.then((unlisten) => unlisten());
      reject(event.payload);
    });
  });
}
