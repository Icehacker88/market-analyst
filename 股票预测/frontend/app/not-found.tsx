import { AppLink } from "@/components/app-link";

export default function NotFound() {
  return <main className="system-state-page"><h1>没有找到这个页面</h1><p>资产代码可能已变化，也可以回到资产目录重新搜索。</p><div><AppLink href="/">返回首页</AppLink><AppLink href="/stocks/">资产目录</AppLink></div></main>;
}

