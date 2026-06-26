import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { deleteCookie } from "@/lib/tauri";
import type { CookieRecord } from "@/types/app";

export function CookieDeleteDialog({
  cookie,
  onDeleted,
}: {
  cookie: CookieRecord;
  onDeleted: () => Promise<void>;
}) {
  async function confirmDelete() {
    try {
      await deleteCookie(cookie.id);
      toast.success("Cookie 已删除");
      await onDeleted();
    } catch (error) {
      toast.error(`删除 Cookie 失败：${String(error)}`);
    }
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="destructive" size="sm">
          <Trash2 data-icon="inline-start" />
          删除
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>删除 Cookie？</AlertDialogTitle>
          <AlertDialogDescription>
            将删除「{cookie.name}」。如果它正在被监听使用，后端会阻止删除。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction onClick={confirmDelete}>删除</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
