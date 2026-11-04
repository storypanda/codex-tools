import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const modulePath = process.env.CODEX_TOOLS_PLAYWRIGHT_MODULE;
const { chromium } = await import(modulePath ? pathToFileURL(modulePath).href : "playwright");
const output = path.resolve(process.env.CODEX_TOOLS_UI_OUTPUT_DIR ?? ".codex-verification/openai-api");
const baseUrl = process.env.CODEX_TOOLS_UI_BASE_URL ?? "http://127.0.0.1:5199/tests/ui/preview.html";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CODEX_TOOLS_CHROME_PATH });
const context = await browser.newContext({ viewport: { width: 1586, height: 992 }, reducedMotion: "reduce" });
const page = await context.newPage();
page.setDefaultTimeout(10000);
const errors = [];
const checks = [];
page.on("pageerror", (error) => errors.push(error.message));
const check = (name, value) => { assert.ok(value, name); checks.push(name); console.log(`✓ ${name}`); };
const snap = (name) => page.screenshot({ path: path.join(output, `${name}.png`), animations: "disabled" });
const dialog = () => page.locator(".openAiBalanceDialog");
const sessionInput = () => dialog().getByLabel("Platform Session Key 或 JSON", { exact: true });
const openSession = async () => {
  await page.getByRole("button", { name: "导入 Session 查询", exact: true }).click();
  await dialog().waitFor();
};
const query = async (session) => {
  await openSession();
  await sessionInput().fill(session);
  await dialog().getByRole("button", { name: "查询余额", exact: true }).click();
};
try {
  await page.goto(`${baseUrl}?scenario=openai`);
  await page.locator(".openAiBalanceCard").waitFor();
  check("Official account is identified and unknown balance is not displayed as zero",
    (await page.locator(".accountRow").innerText()).includes("OpenAI 官方") &&
    (await page.locator(".openAiBalanceAmount").innerText()) === "尚未查询");
  check("Rendering does not send a billing query", await page.evaluate(() => !window.__previewCommands.includes("query_openai_balance")));
  check("API accounts offer editing without ChatGPT reauthorization",
    await page.locator(".quickActionCard").getByRole("button", { name: "编辑 API 账号", exact: true }).count() === 1 &&
    await page.locator(".quickActionCard").getByRole("button", { name: "重新授权", exact: true }).count() === 0);
  await snap("official-account-light");
  await openSession();
  check("Empty Session cannot be submitted", await dialog().getByRole("button", { name: "查询余额", exact: true }).isDisabled());
  check("Session is masked by default", await sessionInput().getAttribute("type") === "password");
  await snap("session-dialog-light");
  await sessionInput().fill("sess-valid");
  await dialog().getByLabel("组织 ID（可选）", { exact: true }).fill("org-preview");
  await dialog().getByRole("button", { name: "查询余额", exact: true }).click();
  await dialog().waitFor({ state: "detached" });
  check("Session query updates balance in details and account list",
    (await page.locator(".openAiBalanceAmount").innerText()) === "$42.50" &&
    (await page.locator(".accountRow .accountStatsCell").innerText()).includes("$42.50"));
  check("Saved balance carries its query time", (await page.locator(".openAiBalanceCard").innerText()).includes("上次查询"));
  check("Session input is removed after success and is not stored in localStorage",
    await page.locator('input[value="sess-valid"]').count() === 0 &&
    await page.evaluate(() => !JSON.stringify(localStorage).includes("sess-valid")));
  await query("sess-expired");
  await dialog().getByRole("alert").waitFor();
  check("Expired Session is actionable and preserves the last known balance",
    (await dialog().getByRole("alert").innerText()).includes("过期") &&
    (await page.locator(".openAiBalanceAmount").innerText()) === "$42.50");
  await dialog().getByRole("button", { name: "取消", exact: true }).click();
  await query("sess-zero");
  await dialog().waitFor({ state: "detached" });
  check("A real zero balance is displayed", (await page.locator(".openAiBalanceAmount").innerText()) === "$0.00");
  await openSession();
  check("Session is cleared when reopened", (await sessionInput().inputValue()) === "");
  await dialog().locator('input[type="file"]').setInputFiles({
    name: "platform-session.json", mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ user: { session: { sensitive_id: "sess-file" } } })),
  });
  await dialog().getByText("platform-session.json", { exact: true }).waitFor();
  check("Platform JSON files can be imported while keeping the field masked",
    (await sessionInput().inputValue()).includes("sess-file") && await sessionInput().getAttribute("type") === "password");
  await dialog().getByRole("button", { name: "查询余额", exact: true }).click();
  await dialog().waitFor({ state: "detached" });
  check("Imported Session JSON queries successfully", (await page.locator(".openAiBalanceAmount").innerText()) === "$42.50");
  await page.getByRole("button", { name: "打开官方账单", exact: true }).click();
  check("Billing opens through the native URL command", await page.evaluate(() => window.__previewCommands.includes("open_external_url")));
  await page.locator(".importPrimary").click();
  await page.getByRole("button", { name: "导入 API", exact: true }).click();
  const add = page.locator(".addAuthDialog");
  check("Official API preset fills the official URL and defaults the account name",
    (await add.getByLabel("Base URL", { exact: true }).inputValue()) === "https://api.openai.com/v1" &&
    (await add.getByLabel("名称", { exact: true }).inputValue()) === "OpenAI");
  await add.getByLabel("API Key", { exact: true }).fill("sk-preview-only");
  await add.getByRole("button", { name: "测试连接", exact: true }).click();
  await add.getByRole("status").waitFor();
  check("Official connection test does not invent a balance", !(await add.getByRole("status").innerText()).includes("$"));
  await add.getByLabel("API 服务商", { exact: true }).selectOption("relay");
  check("Switching providers clears the key before using another host", (await add.getByLabel("API Key", { exact: true }).inputValue()) === "");
  await add.getByLabel("API 服务商", { exact: true }).selectOption("openai");
  await add.getByLabel("名称", { exact: true }).fill("OpenAI Secondary");
  await add.getByLabel("API Key", { exact: true }).fill("sk-preview-only");
  await snap("add-official-key-light");
  await add.getByRole("button", { name: "检测并保存", exact: true }).click();
  await add.waitFor({ state: "detached" });
  check("Official key can be saved and is identified in the account list",
    (await page.locator(".accountRow").filter({ hasText: "OpenAI Secondary" }).innerText()).includes("OpenAI 官方"));
  await page.locator(".topActions button").first().click();
  await snap("official-account-dark");
  await openSession();
  await snap("session-dialog-dark");
  for (const viewport of [{ width: 640, height: 500 }, { width: 900, height: 640 }, { width: 375, height: 667 }]) {
    await page.setViewportSize(viewport);
    const bounds = await dialog().boundingBox();
    check(`Session dialog fits ${viewport.width} × ${viewport.height}`, bounds && bounds.x >= 0 && bounds.y >= 0 &&
      bounds.x + bounds.width <= viewport.width && bounds.y + bounds.height <= viewport.height);
    check(`Session dialog has no horizontal overflow at ${viewport.width}px`,
      await dialog().evaluate((element) => element.scrollWidth <= element.clientWidth));
    await snap(`session-dialog-${viewport.width}`);
  }
  await dialog().getByRole("button", { name: "取消", exact: true }).click();
  for (const locale of ["en-US", "ja-JP", "ko-KR", "ru-RU"]) {
    await page.goto(`${baseUrl}?scenario=openai&locale=${locale}`);
    await page.locator(".openAiBalanceCard").waitFor();
    check(`Official balance UI renders in ${locale}`, (await page.locator(".openAiBalanceCard").innerText()).includes("OpenAI"));
  }
  check("No browser runtime errors", errors.length === 0);
  await writeFile(path.join(output, "checks.json"), JSON.stringify({ checks, errors }, null, 2));
  console.log(`\n${checks.length} OpenAI UI checks passed using the preview backend.`);
} catch (error) {
  await snap("failure");
  throw error;
} finally {
  await browser.close();
}
