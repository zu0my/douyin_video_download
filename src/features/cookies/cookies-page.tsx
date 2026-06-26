import { useEffect, useState } from "react";
import { Cookie, RefreshCw } from "lucide-react";
import { AnimatedPage } from "@/components/animated-page";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CookieCreateDialog } from "@/features/cookies/cookie-create-dialog";
import { CookieDeleteDialog } from "@/features/cookies/cookie-delete-dialog";
import { CookieRefillDialog } from "@/features/cookies/cookie-refill-dialog";
import { BrowserBridgeCard } from "@/features/cookies/browser-bridge-card";
import { listCookies } from "@/lib/tauri";
import type { CookieRecord } from "@/types/app";

export function CookiesPage() {
  const [cookies, setCookies] = useState<CookieRecord[]>([]);

  async function refresh() {
    setCookies(await listCookies().catch(() => []));
  }

  useEffect(() => {
    void refresh();
  }, []);

  return (
    <AnimatedPage>
      <div className="flex h-[calc(100dvh-1.5rem)] min-h-0 min-w-0 flex-col gap-4 lg:h-[calc(100dvh-2.5rem)]">
        <PageHeader
          eyebrow="凭据管理"
          title="Cookie 管理"
          actions={
            <>
              <Button
                variant="outline"
                size="icon"
                onClick={() => void refresh()}
              >
                <RefreshCw data-icon="inline-start" />
              </Button>
              <CookieCreateDialog onSaved={refresh} />
            </>
          }
        />
        <BrowserBridgeCard />
        {cookies.length ? (
          <Card className="min-w-0">
            <CardHeader>
              <CardTitle>已保存的 Cookie</CardTitle>
              <CardDescription>
                手动凭据和 Chrome 自动同步账号统一在这里管理。
              </CardDescription>
            </CardHeader>
            <CardContent className="min-w-0">
              <div className="overflow-x-auto">
                <Table className="min-w-[820px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[220px]">名称</TableHead>
                      <TableHead className="w-[120px]">来源</TableHead>
                      <TableHead>备注</TableHead>
                      <TableHead className="w-[220px]">更新时间</TableHead>
                      <TableHead className="w-[180px] text-right">
                        操作
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {cookies.map((cookie) => (
                      <TableRow key={cookie.id}>
                        <TableCell className="max-w-[220px] truncate font-medium">
                          {cookie.name}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              cookie.source === "chrome"
                                ? "default"
                                : "secondary"
                            }
                          >
                            {cookie.source === "chrome"
                              ? "Chrome 自动同步"
                              : "手动"}
                          </Badge>
                        </TableCell>
                        <TableCell className="max-w-[260px] truncate text-muted-foreground">
                          {cookie.note || "-"}
                        </TableCell>
                        <TableCell className="max-w-[220px] truncate text-muted-foreground">
                          {cookie.lastSyncedAt || cookie.updatedAt}
                        </TableCell>
                        <TableCell>
                          <div className="flex justify-end gap-2">
                            <CookieRefillDialog
                              cookie={cookie}
                              onSaved={refresh}
                            />
                            <CookieDeleteDialog
                              cookie={cookie}
                              onDeleted={refresh}
                            />
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        ) : (
          <EmptyState
            icon={<Cookie />}
            title="还没有 Cookie"
            description="先添加一个 Cookie，再创建监听任务。"
          />
        )}
      </div>
    </AnimatedPage>
  );
}
