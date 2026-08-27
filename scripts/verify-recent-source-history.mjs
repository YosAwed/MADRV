import { chromium } from "playwright-core";

const baseUrl = process.env.MADRV_E2E_BASE_URL ?? "http://127.0.0.1:3000";
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.addInitScript(() => {
    window.localStorage.setItem("madrv-player.recent-sources-v1", JSON.stringify([
      { id: "remote:https://example.test/remote.mdr", kind: "remote", label: "REMOTE DEMO", format: "mdr", mdrUrl: "https://example.test/remote.mdr", usedAt: 200 },
      { id: "local:last.mdx", kind: "local", label: "LAST.MDX", format: "mdx", pdxName: "LAST.PDX", usedAt: 100 },
    ]));
  });
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  const recent = page.getByTestId("recent-sources");
  await recent.getByText("REMOTE DEMO", { exact: true }).waitFor({ state: "visible" });
  await recent.getByText("LAST.MDX", { exact: true }).waitFor({ state: "visible" });
  await recent.getByText("Local · reselect · MDX · LAST.PDX", { exact: true }).waitFor({ state: "visible" });
  await recent.getByRole("button", { name: "履歴からREMOTE DEMOを削除" }).click();
  if (await recent.getByText("REMOTE DEMO", { exact: true }).count() !== 0) throw new Error("Remote history item remained after removal.");
  await recent.getByRole("button", { name: "Clear" }).click();
  if (await page.getByTestId("recent-sources").count() !== 0) throw new Error("Recent source history remained after clearing.");
  console.log(JSON.stringify({ localReselectHintVisible: true, deleteWorks: true, clearWorks: true }));
} finally {
  await browser.close();
}
