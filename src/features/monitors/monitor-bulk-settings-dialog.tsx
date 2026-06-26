import { useEffect, useState, type ComponentProps } from "react";
import { Settings } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
  FieldContent,
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

export function MonitorBulkSettingsDialog({
  monitors,
  cookies,
  onSaved,
  disabled,
  variant = "outline",
  size = "sm",
}: {
  monitors: Monitor[];
  cookies: CookieRecord[];
  onSaved: () => Promise<void>;
  disabled?: boolean;
  variant?: ComponentProps<typeof Button>["variant"];
  size?: ComponentProps<typeof Button>["size"];
}) {
  const [open, setOpen] = useState(false);
  const [updateCookie, setUpdateCookie] = useState(false);
  const [updateInterval, setUpdateInterval] = useState(true);
  const [cookieId, setCookieId] = useState("");
  const [intervalMinutes, setIntervalMinutes] = useState(5);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }
    setUpdateCookie(false);
    setUpdateInterval(true);
    setCookieId(monitors[0]?.cookieId ?? "");
    setIntervalMinutes(monitors[0]?.intervalMinutes ?? 5);
  }, [open]);

  const canSubmit =
    monitors.length > 0 &&
    (updateCookie || updateInterval) &&
    (!updateCookie || Boolean(cookieId)) &&
    (!updateInterval || intervalMinutes >= 1);

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      for (const monitor of monitors) {
        await updateMonitorSettings({
          id: monitor.id,
          cookieId: updateCookie ? cookieId : monitor.cookieId,
          intervalMinutes: updateInterval
            ? intervalMinutes
            : monitor.intervalMinutes,
        });
      }
      toast.success(`已更新 ${monitors.length} 个监听设置`);
      setOpen(false);
      await onSaved();
    } catch (error) {
      toast.error(`批量更新监听设置失败：${String(error)}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={variant} size={size} disabled={disabled}>
          <Settings data-icon="inline-start" />
          批量设置
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>批量监听设置</DialogTitle>
          <DialogDescription>
            将配置应用到已选择的 {monitors.length} 个监听项。未勾选的配置不会被覆盖。
          </DialogDescription>
        </DialogHeader>
        <FieldGroup className="py-2">
          <Field orientation="horizontal">
            <Checkbox
              checked={updateCookie}
              onCheckedChange={(checked) => setUpdateCookie(checked === true)}
              aria-label="批量修改 Cookie"
            />
            <FieldContent>
              <FieldLabel>修改 Cookie</FieldLabel>
              <FieldDescription>
                监听中的任务保存后会按新 Cookie 重启调度。
              </FieldDescription>
            </FieldContent>
          </Field>
          <Field data-disabled={!updateCookie}>
            <FieldLabel>Cookie</FieldLabel>
            <Select
              value={cookieId}
              onValueChange={setCookieId}
              disabled={!updateCookie}
            >
              <SelectTrigger className="w-full">
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
          <Field orientation="horizontal">
            <Checkbox
              checked={updateInterval}
              onCheckedChange={(checked) => setUpdateInterval(checked === true)}
              aria-label="批量修改监听间隔"
            />
            <FieldContent>
              <FieldLabel>修改监听间隔</FieldLabel>
              <FieldDescription>最小 1 分钟。</FieldDescription>
            </FieldContent>
          </Field>
          <Field
            data-disabled={!updateInterval}
            data-invalid={updateInterval && intervalMinutes < 1}
          >
            <FieldLabel htmlFor="bulk-monitor-interval">间隔（分钟）</FieldLabel>
            <Input
              id="bulk-monitor-interval"
              type="number"
              min={1}
              disabled={!updateInterval}
              aria-invalid={updateInterval && intervalMinutes < 1}
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
          <Button onClick={submit} disabled={submitting || !canSubmit}>
            {submitting && <Spinner data-icon="inline-start" />}
            {submitting ? "保存中" : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
