import { Search } from "lucide-react";
import { AnimatedPage } from "@/components/animated-page";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";

export function AiPage() {
  return (
    <AnimatedPage>
      <div className="flex h-[calc(100vh-2.5rem)] min-h-0 flex-col gap-4">
        <PageHeader eyebrow="预留能力" title="AI 搜索" />
        <EmptyState
          icon={<Search />}
          title="AI 搜索暂未实现"
          description="下载、监听、筛选稳定后再接入语义检索和视觉摘要。"
        />
      </div>
    </AnimatedPage>
  );
}
