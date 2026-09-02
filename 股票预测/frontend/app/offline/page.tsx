import { WifiOff } from "lucide-react";
import { AppLink } from "@/components/app-link";

export default function OfflinePage() {
  return <main className="system-state-page"><WifiOff size={28} /><h1>当前没有网络连接</h1><p>已打开过的行情和页面仍可从缓存读取。恢复网络后，收藏与设置会自动同步。</p><AppLink href="/">返回首页</AppLink></main>;
}

