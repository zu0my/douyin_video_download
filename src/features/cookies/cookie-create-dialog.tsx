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
import { Spinner } from "@/components/ui/spinner";
import { createCookie } from "@/lib/tauri";

export function CookieCreateDialog({
  onSaved,
}: {
  onSaved: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    if (!name.trim() || !value.trim()) return;
    setSubmitting(true);
    try {
      await createCookie({
        name: name.trim(),
        value: value.trim(),
        note: note.trim() || undefined,
      });
      toast.success("Cookie 已保存");
      setName("");
      setValue("");
      setNote("");
      setOpen(false);
      await onSaved();
    } catch (error) {
      toast.error(`保存 Cookie 失败：${String(error)}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus data-icon="inline-start" />
          新增 Cookie
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>新增 Cookie</DialogTitle>
          <DialogDescription>
            Cookie 会加密保存，列表不会展示明文。
          </DialogDescription>
        </DialogHeader>
        <FieldGroup className="py-2">
          <Field>
            <FieldLabel htmlFor="cookie-name">名称</FieldLabel>
            <Input
              id="cookie-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="cookie-value">Cookie</FieldLabel>
            <Input
              id="cookie-value"
              type="password"
              value={value}
              onChange={(event) => setValue(event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="cookie-note">备注</FieldLabel>
            <Input
              id="cookie-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </Field>
        </FieldGroup>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            取消
          </Button>
          <Button
            onClick={submit}
            disabled={submitting || !name.trim() || !value.trim()}
          >
            {submitting && <Spinner data-icon="inline-start" />}
            {submitting ? "保存中" : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
