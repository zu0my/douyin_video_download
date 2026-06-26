import { useState } from "react";
import { KeyRound } from "lucide-react";
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
import { Spinner } from "@/components/ui/spinner";
import { updateCookieValue } from "@/lib/tauri";
import type { CookieRecord } from "@/types/app";

export function CookieRefillDialog({
  cookie,
  onSaved,
}: {
  cookie: CookieRecord;
  onSaved: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    if (!value.trim()) return;
    setSubmitting(true);
    try {
      await updateCookieValue(cookie.id, value.trim());
      toast.success("Cookie 已重填");
      setValue("");
      setOpen(false);
      await onSaved();
    } catch (error) {
      toast.error(`重填 Cookie 失败：${String(error)}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <KeyRound data-icon="inline-start" />
          重填
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>重填 Cookie</DialogTitle>
          <DialogDescription>
            为「{cookie.name}」写入新的 Cookie 明文。
          </DialogDescription>
        </DialogHeader>
        <FieldGroup className="py-2">
          <Field>
            <FieldLabel htmlFor={`refill-${cookie.id}`}>Cookie</FieldLabel>
            <Input
              id={`refill-${cookie.id}`}
              type="password"
              value={value}
              onChange={(event) => setValue(event.target.value)}
            />
          </Field>
        </FieldGroup>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            取消
          </Button>
          <Button onClick={submit} disabled={submitting || !value.trim()}>
            {submitting && <Spinner data-icon="inline-start" />}
            {submitting ? "保存中" : "保存重填"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
