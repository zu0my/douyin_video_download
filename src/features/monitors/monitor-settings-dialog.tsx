import { useEffect, useState, type ComponentProps } from "react";
import { Settings } from "lucide-react";
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
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
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
import { updateMonitorSettings } from "@/lib/tauri";
import type { CookieRecord, Monitor } from "@/types/app";

export function MonitorSettingsDialog({
  monitor,
  cookies,
  onSaved,
  variant = "outline",
  size = "sm",
}: {
  monitor: Monitor;
  cookies: CookieRecord[];
  onSaved: () => Promise<void>;
  variant?: ComponentProps<typeof Button>["variant"];
  size?: ComponentProps<typeof Button>["size"];
}) {
  const [open, setOpen] = useState(false);
  const [cookieId, setCookieId] = useState(monitor.cookieId);
  const [intervalMinutes, setIntervalMinutes] = useState(
    monitor.intervalMinutes,
  );
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCookieId(monitor.cookieId);
    setIntervalMinutes(monitor.intervalMinutes);
  }, [monitor.cookieId, monitor.intervalMinutes, open]);

  async function submit() {
    if (!cookieId || intervalMinutes < 1) return;
    setSubmitting(true);
    try {
      await updateMonitorSettings({
        id: monitor.id,
        cookieId,
        intervalMinutes,
      });
      toast.success("监听设置已更新");
      setOpen(false);
      await onSaved();
    } catch (error) {
      toast.error(`更新监听设置失败：${String(error)}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant={variant}
          size={size}
          onClick={(event) => {
            event.stopPropagation();
          }}
        >
          <Settings data-icon="inline-start" />
          设置
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>监听设置</DialogTitle>
          <DialogDescription>
            修改 Cookie 或监听间隔后，监听中的任务会立即按新设置重启调度。
          </DialogDescription>
        </DialogHeader>
        <FieldGroup className="py-2">
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
            <FieldDescription>当前：{monitor.cookieName}</FieldDescription>
          </Field>
          <Field data-invalid={intervalMinutes < 1}>
            <FieldLabel htmlFor={`monitor-interval-${monitor.id}`}>
              间隔（分钟）
            </FieldLabel>
            <Input
              id={`monitor-interval-${monitor.id}`}
              type="number"
              min={1}
              aria-invalid={intervalMinutes < 1}
              value={intervalMinutes}
              onChange={(event) =>
                setIntervalMinutes(Number(event.target.value))
              }
            />
            <FieldDescription>最小 1 分钟。</FieldDescription>
          </Field>
        </FieldGroup>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            取消
          </Button>
          <Button
            onClick={submit}
            disabled={submitting || !cookieId || intervalMinutes < 1}
          >
            {submitting && <Spinner data-icon="inline-start" />}
            {submitting ? "保存中" : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
