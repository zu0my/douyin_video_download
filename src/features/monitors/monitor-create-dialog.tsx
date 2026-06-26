import { useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { createMonitor } from "@/lib/tauri";
import type { CookieRecord } from "@/types/app";

export function MonitorCreateDialog({
  cookies,
  onCreated,
}: {
  cookies: CookieRecord[];
  onCreated: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [cookieId, setCookieId] = useState("");
  const [intervalMinutes, setIntervalMinutes] = useState(30);
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    if (!url.trim() || !cookieId) return;
    setSubmitting(true);
    try {
      await createMonitor({ url: url.trim(), cookieId, intervalMinutes });
      toast.success("监听已添加");
      setUrl("");
      setCookieId("");
      setOpen(false);
      await onCreated();
    } catch (error) {
      toast.error(`添加监听失败：${String(error)}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus data-icon="inline-start" />
          添加监听
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>添加监听</DialogTitle>
          <DialogDescription>
            输入抖音用户主页，选择 Cookie，并设置监听间隔。
          </DialogDescription>
        </DialogHeader>
        <FieldGroup className="py-2">
          <Field>
            <FieldLabel htmlFor="monitor-url">用户主页 URL</FieldLabel>
            <Input
              id="monitor-url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://www.douyin.com/user/..."
            />
          </Field>
          <Field>
            <FieldLabel>Cookie</FieldLabel>
            <Select value={cookieId} onValueChange={setCookieId}>
              <SelectTrigger>
                <SelectValue placeholder="选择 Cookie" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {cookies.map((cookie) => (
                    <SelectItem key={cookie.id} value={cookie.id}>
                      {cookie.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="monitor-interval">间隔（分钟）</FieldLabel>
            <Input
              id="monitor-interval"
              type="number"
              min={1}
              value={intervalMinutes}
              onChange={(event) =>
                setIntervalMinutes(Number(event.target.value))
              }
            />
          </Field>
        </FieldGroup>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            取消
          </Button>
          <Button
            onClick={submit}
            disabled={
              submitting || !url.trim() || !cookieId || intervalMinutes < 1
            }
          >
            {submitting && <Spinner data-icon="inline-start" />}
            {submitting ? "添加中" : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
