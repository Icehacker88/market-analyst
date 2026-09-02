"use client";

import { useEffect } from "react";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error("Orivane page error", error); }, [error]);
  return <main className="system-state-page"><h1>页面暂时无法显示</h1><p>你的收藏和设置不会丢失。可以重试，或返回首页继续使用其他功能。</p><div><button onClick={reset}>重新加载</button><a href="/">返回首页</a></div></main>;
}

