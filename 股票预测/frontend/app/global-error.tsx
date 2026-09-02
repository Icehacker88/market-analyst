"use client";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <html lang="zh-CN"><body><main className="system-state-page"><h1>Orivane 需要重新加载</h1><p>本地缓存仍会保留。</p><button onClick={reset}>重新加载</button></main></body></html>;
}

