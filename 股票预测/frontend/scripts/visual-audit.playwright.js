async (page) => {
  const baseUrl = page.url().match(/^https?:\/\/[^/]+/)?.[0] || "http://127.0.0.1:3001";
  const routes = [
    ["home", "/"],
    ["recommendations", "/recommendations/"],
    ["track-record", "/track-record/"],
    ["screener", "/screener/"],
    ["favorites", "/favorites/"],
    ["portfolio", "/portfolio/"],
    ["stocks", "/stocks/"],
    ["methodology", "/methodology/"],
    ["risk-disclosure", "/risk-disclosure/"],
    ["privacy", "/privacy/"],
    ["terms", "/terms/"],
    ["monitor", "/monitor/"],
    ["market-topic", "/markets/global-semiconductor-forecast/"],
    ["stock-us", "/stocks/nvda/"],
    ["stock-a", "/stocks/300750-sz/"],
    ["comparison", "/analysis?symbols=NVDA,AAPL"],
  ];
  const viewports = [
    ["desktop", { width: 1440, height: 1000 }],
    ["mobile", { width: 390, height: 844 }],
  ];
  const results = [];
  let consoleErrors = [];
  let failedResponses = [];

  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("response", (response) => {
    if (response.status() >= 400) {
      failedResponses.push(`${response.status()} ${response.url()}`);
    }
  });

  for (const [viewportName, viewport] of viewports) {
    await page.setViewportSize(viewport);

    for (const [routeName, route] of routes) {
      consoleErrors = [];
      failedResponses = [];
      await page.goto(`${baseUrl}${route}`, {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      });
      await page.waitForTimeout(1_200);

      const diagnostics = await page.evaluate(() => {
        const isVisible = (element) => {
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return (
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            Number(style.opacity) !== 0 &&
            rect.width > 0 &&
            rect.height > 0
          );
        };
        const labelFor = (element) =>
          element.getAttribute("aria-label") ||
          element.getAttribute("title") ||
          element.textContent?.trim() ||
          element.tagName.toLowerCase();
        const overflowElements = [...document.querySelectorAll("body *")]
          .filter(isVisible)
          .filter((element) => {
            const rect = element.getBoundingClientRect();
            return rect.right > window.innerWidth + 2 || rect.left < -2;
          })
          .slice(0, 12)
          .map((element) => ({
            element: labelFor(element).slice(0, 80),
            className: String(element.className || "").slice(0, 100),
            rect: {
              left: Math.round(element.getBoundingClientRect().left),
              right: Math.round(element.getBoundingClientRect().right),
              width: Math.round(element.getBoundingClientRect().width),
            },
          }));
        const brokenImages = [...document.images]
          .filter((image) => image.complete && image.naturalWidth === 0)
          .map((image) => ({ src: image.currentSrc || image.src, alt: image.alt }));
        const unlabeledIconControls = [
          ...document.querySelectorAll("button, a[href]"),
        ]
          .filter(isVisible)
          .filter((element) => element.querySelector("svg"))
          .filter(
            (element) =>
              !element.getAttribute("aria-label") &&
              !element.getAttribute("title") &&
              !(element.textContent || "").trim(),
          )
          .slice(0, 12)
          .map((element) => String(element.className || element.tagName));
        const clippedText = [...document.querySelectorAll("body *")]
          .filter(isVisible)
          .filter((element) => (element.textContent || "").trim())
          .filter((element) => {
            const style = getComputedStyle(element);
            return (
              (style.overflowX === "hidden" || style.textOverflow === "ellipsis") &&
              element.scrollWidth > element.clientWidth + 2
            );
          })
          .slice(0, 12)
          .map((element) => ({
            text: (element.textContent || "").trim().slice(0, 80),
            className: String(element.className || "").slice(0, 100),
          }));
        const tinyText = [...document.querySelectorAll("body *")]
          .filter(isVisible)
          .filter((element) => element.children.length === 0)
          .filter((element) => (element.textContent || "").trim())
          .filter((element) => parseFloat(getComputedStyle(element).fontSize) < 11)
          .slice(0, 12)
          .map((element) => ({
            text: (element.textContent || "").trim().slice(0, 80),
            size: getComputedStyle(element).fontSize,
          }));

        return {
          title: document.title,
          lang: document.documentElement.lang,
          fontStatus: document.fonts.status,
          bodyFont: getComputedStyle(document.body).fontFamily,
          headingFont:
            getComputedStyle(document.querySelector("h1, h2, h3") || document.body)
              .fontFamily,
          viewportWidth: window.innerWidth,
          documentWidth: document.documentElement.scrollWidth,
          horizontalOverflow:
            document.documentElement.scrollWidth > window.innerWidth + 2,
          overflowElements,
          brokenImages,
          unlabeledIconControls,
          clippedText,
          tinyText,
        };
      });

      const screenshotPath = `output/playwright/visual-audit-2026-08-22/${viewportName}-${routeName}.png`;
      await page.screenshot({ path: screenshotPath, fullPage: true });
      results.push({
        viewport: viewportName,
        route,
        screenshotPath,
        consoleErrors: [...new Set(consoleErrors)].slice(0, 12),
        failedResponses: [...new Set(failedResponses)].slice(0, 12),
        ...diagnostics,
      });
    }
  }

  return results;
}
