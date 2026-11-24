import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

const app = process.env.QA_APP_URL ?? "http://localhost:55420";
const screenshots = process.env.QA_SCREENSHOTS ?? "/tmp/mafia-seasons-qa";
const password = process.env.QA_PASSWORD ?? "Synthetic-QA-Only-2026";
assert.match(app, /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/);
await mkdir(screenshots, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? "/usr/bin/chromium",
  args: ["--no-sandbox"],
});

async function capture(page, name) {
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    `Horizontal overflow at ${JSON.stringify(page.viewportSize())}: ${page.url()}`);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.screenshot({ path: resolve(screenshots, `${name}.png`), animations: "disabled", fullPage: true });
}

async function login(context, email) {
  const page = await context.newPage();
  await page.goto(`${app}/login`, { waitUntil: "domcontentloaded" });
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await page.waitForURL((url) => url.pathname !== "/login", { waitUntil: "commit" });
  return page;
}

try {
  const year = new Intl.DateTimeFormat("en", { year: "numeric", timeZone: "Europe/Vienna" }).format(new Date());
  const publicContext = await browser.newContext();
  const page = await publicContext.newPage();
  await page.goto(`${app}/history/seasons`);
  await page.getByRole("heading", { name: `Сезон ${year}` }).waitFor();
  const quarter = page.getByRole("navigation", { name: "Кварталы сезона" });
  await quarter.getByRole("link", { name: "1 квартал", exact: true }).click();
  await page.getByRole("heading", { name: `${year} · 1 квартал` }).waitFor();
  await page.getByRole("link", { name: "Вся история", exact: true }).click();
  await page.getByRole("heading", { name: "Вся история", exact: true }).waitFor();
  await page.getByRole("navigation", { name: "Формат" }).getByRole("link", { name: "Девятка" }).click();
  await page.getByRole("table").getByRole("columnheader", { name: "Ничьи" }).waitFor();
  assert.match(await page.getByRole("table").locator("tbody td").first().innerText(), /^\d+\/\d+$/);

  for (const [name, width, height] of [["phone", 375, 812], ["ipad", 820, 1180], ["desktop", 1440, 1000]]) {
    await page.setViewportSize({ width, height });
    await capture(page, `seasons-${name}`);
  }
  await publicContext.addCookies([{ name: "mafia-locale", value: "uk", url: app }]);
  await page.reload();
  await page.getByRole("heading", { name: "Результати гравців" }).waitFor();
  await capture(page, "seasons-desktop-uk");

  await page.goto(`${app}/admin/seasons`);
  await page.waitForURL((url) => url.pathname === "/login");
  await publicContext.close();

  const playerContext = await browser.newContext();
  const player = await login(playerContext, process.env.QA_PLAYER_EMAIL ?? "qa-player@example.test");
  await player.goto(`${app}/admin/seasons`);
  await player.waitForURL((url) => url.pathname === "/login" && url.searchParams.get("error") === "forbidden");
  await playerContext.close();

  const adminContext = await browser.newContext({ acceptDownloads: true, viewport: { width: 820, height: 1180 } });
  const admin = await login(adminContext, process.env.QA_ADMIN_EMAIL ?? "qa-admin@example.test");
  await admin.goto(`${app}/admin/seasons`);
  await admin.getByRole("heading", { name: "Предварительные номинации" }).waitFor();
  await admin.getByLabel("Период").selectOption("all");
  await admin.getByLabel("Формат").selectOption("short9");
  await admin.getByLabel("Показатель").selectOption("wins");
  await admin.getByRole("button", { name: "Сформировать список" }).click();
  await admin.getByRole("heading", { name: "Черновик · Победы за свою сторону" }).waitFor();
  await capture(admin, "seasons-nomination-ipad");
  const [download] = await Promise.all([
    admin.waitForEvent("download"),
    admin.getByRole("link", { name: "Скачать черновик для Telegram" }).click(),
  ]);
  assert.equal(download.suggestedFilename(), "mafia-league-all-short9-draft.txt");
  const draft = await readFile(await download.path(), "utf8");
  assert.match(draft, /^Черновик · Победы за свою сторону\nВся история · Девятка/m);
  assert.match(draft, /^• .+ · \d+\/\d+$/m);
  assert(!draft.includes("@example.test"));
  await adminContext.close();
  console.log("Chromium seasons, access, layouts and draft export passed.");
} finally {
  await browser.close();
}
