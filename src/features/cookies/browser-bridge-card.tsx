import { useEffect, useState } from "react";
import {
  Check,
  Clipboard,
  Link2,
  RefreshCw,
  Save,
} from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import {
  getBridgeSettings,
  updateBridgeSettings,
} from "@/lib/tauri";
import type { BridgeSettings } from "@/types/app";

export function BrowserBridgeCard() {
  const [settings, setSettings] = useState<BridgeSettings>();
  const [interval, setInterval] = useState(30);
  const [busy, setBusy] = useState<"refresh" | "save">();
  const [copied, setCopied] = useState(false);

  async function refresh() {
    setBusy("refresh");
    try {
      const next = await getBridgeSettings();
      setSettings(next);
      setInterval(next.defaultIntervalMinutes);
    } catch (error) {
      toast.error(`读取浏览器连接设置失败：${String(error)}`);
    } finally {
      setBusy(undefined);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success("接口地址已复制");
      window.setTimeout(() => setCopied(false), 1600);
    } catch (error) {
      toast.error(`复制失败：${String(error)}`);
    }
  }

  async function save() {
    if (interval < 1) return;
    setBusy("save");
    try {
      await updateBridgeSettings(interval);
      toast.success("默认监听间隔已保存");
      await refresh();
    } catch (error) {
      toast.error(`保存失败：${String(error)}`);
      setBusy(undefined);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Link2 className="size-4" />
          Chrome 插件连接
        </CardTitle>
        <CardDescription>
          插件通过本机回环接口同步 Chrome Cookie，并一键添加用户监听。
        </CardDescription>
        <CardAction className="flex items-center gap-2">
          <Badge variant={settings?.running ? "default" : "destructive"}>
            {settings?.running ? "服务运行中" : "服务未运行"}
          </Badge>
          <Button
            variant="outline"
            size="icon"
            disabled={Boolean(busy)}
            onClick={() => void refresh()}
            aria-label="刷新连接状态"
          >
            {busy === "refresh" ? (
              <Spinner />
            ) : (
              <RefreshCw data-icon="inline-start" />
            )}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          {settings?.error && (
            <Alert variant="destructive">
              <AlertTitle>本地桥接服务启动失败</AlertTitle>
              <AlertDescription>{settings.error}</AlertDescription>
            </Alert>
          )}
          <Field>
            <FieldLabel htmlFor="bridge-endpoint">接口地址</FieldLabel>
            <div className="flex gap-2">
              <Input
                id="bridge-endpoint"
                readOnly
                value={settings?.endpoint || "正在读取…"}
              />
              <Button
                variant="outline"
                disabled={!settings}
                onClick={() => settings && void copy(settings.endpoint)}
              >
                {copied ? (
                  <Check data-icon="inline-start" />
                ) : (
                  <Clipboard data-icon="inline-start" />
                )}
                复制
              </Button>
            </div>
          </Field>
          <Field>
            <FieldLabel htmlFor="default-monitor-interval">
              插件新增监听的默认间隔（分钟）
            </FieldLabel>
            <div className="flex max-w-md gap-2">
              <Input
                id="default-monitor-interval"
                type="number"
                min={1}
                value={interval}
                onChange={(event) => setInterval(Number(event.target.value))}
              />
              <Button
                disabled={interval < 1 || Boolean(busy)}
                onClick={() => void save()}
              >
                {busy === "save" ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <Save data-icon="inline-start" />
                )}
                保存
              </Button>
            </div>
          </Field>
        </FieldGroup>
      </CardContent>
    </Card>
  );
}
