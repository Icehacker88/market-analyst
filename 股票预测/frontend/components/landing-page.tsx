import { AppLink as Link } from "./app-link";
import { HomeSearch } from "./home-search";
import { HomeDiscovery } from "./home-discovery";
import { HomeScoreboard } from "./home-scoreboard";
import { HomeReturning } from "./home-returning";
import s from "./home.module.css";

// Static content stays outside the interactive islands; locale follows the document language.
export function LandingPage() {
  return <main className={s.home}>
    <section className={s.hero}>
      <span className={s.eyebrow}>ORIVANE · <span className={s.zh}>投资研究工作台</span><span className={s.en}>INVESTMENT RESEARCH</span></span>
      <h1><span className={s.zh}>找到资产，深入研究。</span><span className={s.en}>Find an asset. Build your research.</span></h1>
      <p><span className={s.zh}>股票与基金投资研究：结合历史表现、预测与风险，形成可跟踪的判断。</span><span className={s.en}>Research stocks and funds with historical returns, forecasts and risk — then track your thesis.</span></p>
      <HomeSearch />
      <nav className={s.auxLinks} aria-label="Research tools"><Link href="/screener/"><span className={s.zh}>条件筛选</span><span className={s.en}>Asset screener</span></Link><Link href="/track-record/"><span className={s.zh}>预测成绩</span><span className={s.en}>Forecast record</span></Link><Link href="/recommendations/"><span className={s.zh}>研究候选</span><span className={s.en}>Research candidates</span></Link></nav>
    </section>
    <HomeDiscovery />
    <HomeReturning />
    <HomeScoreboard />
  </main>;
}
