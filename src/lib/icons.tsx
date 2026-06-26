import { Icon } from "@iconify/react";
import type { ComponentProps } from "react";

type AppIconProps = Omit<ComponentProps<typeof Icon>, "icon">;

export function DouyinIcon(props: AppIconProps) {
  return <Icon icon="simple-icons:douyin" {...props} />;
}

export function VideoFileIcon(props: AppIconProps) {
  return <Icon icon="solar:video-frame-playback-bold-duotone" {...props} />;
}

export function ImageFileIcon(props: AppIconProps) {
  return <Icon icon="solar:gallery-wide-bold-duotone" {...props} />;
}
