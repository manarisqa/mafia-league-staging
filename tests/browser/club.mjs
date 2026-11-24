import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";

const app = process.env.QA_APP_URL ?? "http://127.0.0.1:55420";
const screenshots = process.env.QA_SCREENSHOTS ?? "/tmp/mafia-club-qa";
const password = process.env.QA_PASSWORD ?? "Synthetic-QA-Only-2026";
assert.match(app, /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/, "Club browser checks require a local synthetic app");
await mkdir(screenshots, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? "/usr/bin/chromium",
  headless: true, args: ["--no-sandbox"],
});
const button = (page, name) => page.getByRole("button", { name, exact: true });
const text = (page, name) => page.getByText(name, { exact: true });
const idSuffix = Date.now();
const nickname = "QA Гость " + idSuffix;
const email = "qa-evening-" + idSuffix + "@example.test";

function allowCompile(page) {
  page.setDefaultTimeout(90_000);
  page.setDefaultNavigationTimeout(90_000);
  return page;
}

async function login(page, account) {
  await page.goto(app + "/login");
  await page.locator("#email").fill(account);
  await page.locator("#password").fill(password);
  await button(page, "Войти").click();
  await page.waitForURL((url) => url.pathname !== "/login");
}

async function capture(page, name) {
  await page.evaluate(() => document.fonts.ready);
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), name + " overflows the viewport");
  await page.screenshot({ path: join(screenshots, name + ".png"), animations: "disabled", fullPage: true });
}

try {
  const admin = allowCompile(await browser.newPage({ viewport: { width: 1440, height: 1000 } }));
  await login(admin, process.env.QA_ADMIN_EMAIL ?? "qa-admin@example.test");
  await admin.goto(app + "/admin/evenings");
  const date = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);
  const venue = "QA · Short9 " + idSuffix;
  const privateNote = "Private club QA " + idSuffix;
  await admin.locator("input[name=starts_at]").fill(date + "T19:00");
  await admin.locator("input[name=place]").fill(venue);
  await admin.locator("select[name=capacity]").selectOption("9");
  await admin.locator("select[name=host_player_id]").selectOption({ label: "Ведущий" });
  await admin.locator("textarea[name=note]").fill(privateNote);
  await button(admin, "Создать вечер").click();
  await admin.waitForURL("**/admin/evenings/*");
  const path = new URL(admin.url()).pathname.replace(/^\/admin/, "");

  const guest = allowCompile(await browser.newPage({ viewport: { width: 820, height: 1180 }, permissions: ["clipboard-read", "clipboard-write"] }));
  await guest.goto(app + path);
  await text(guest, venue + " · Время Граца").waitFor();
  await text(guest, "Плановый формат · Девятка").waitFor();
  await text(guest, "Не хватает игроков · 9").waitFor();
  assert(!(await guest.locator("main").innerText()).includes(privateNote));
  await button(guest, "Пригласить друга").click();
  await text(guest, "Ссылка скопирована").waitFor();
  assert.equal(await guest.evaluate(() => navigator.clipboard.readText()), app + path);
  await capture(guest, "evening-guest-ipad");

  await guest.locator('main a[href^="/register?next="]').click();
  await guest.waitForURL("**/register?next=*");
  const withoutScripts = await browser.newPage({ javaScriptEnabled: false });
  try {
    for (const url of [app + "/login", guest.url()]) {
      await withoutScripts.goto(url);
      const credentials = withoutScripts.locator("form:has(#password)");
      assert.equal(await credentials.evaluate((form) => form.method), "post");
    }
  } finally {
    await withoutScripts.close();
  }
  await guest.locator("#nickname").fill(nickname);
  await guest.locator("#email").fill(email);
  await guest.locator("#password").fill(password);
  await button(guest, "Зарегистрироваться").click();
  await guest.waitForURL(app + path);
  await guest.setViewportSize({ width: 375, height: 812 });
  await button(guest, "Возможно").click();
  await text(guest, "Отмечено: возможно, придёте.").waitFor();
  await text(guest, "Не хватает игроков · 9").waitFor();
  await button(guest, "Приду").click();
  await text(guest, "Не хватает игроков · 8").waitFor();
  await capture(guest, "evening-player-phone");
  await button(guest, "Отменить запись").click();
  await text(guest, "Запись отменена.").waitFor();
  await text(guest, "Не хватает игроков · 9").waitFor();
  await guest.goto(app + "/");
  await guest.getByRole("link", { name: "Мой профиль", exact: true }).waitFor();
  await capture(guest, "club-home-player-phone");

  await admin.goto(app + "/history");
  const past = admin.locator("main details").filter({ hasText: "Тест · Graz" }).first();
  if (await past.getAttribute("open") === null) await past.locator("summary").click();
  const pastPath = await past.getByRole("link", { name: "О вечере", exact: true }).getAttribute("href");
  assert(pastPath);
  await admin.goto(app + "/admin" + pastPath);
  const attendance = admin.locator("section").filter({ has: admin.getByRole("heading", { name: "Фактическая посещаемость" }) });
  await attendance.getByRole("checkbox", { name: nickname, exact: true }).check();
  await button(admin, "Сохранить журнал").click();
  await text(admin, "Посещаемость сохранена.").waitFor();
  await admin.reload();
  assert(await attendance.getByRole("checkbox", { name: nickname, exact: true }).isChecked());
  await capture(admin, "attendance-admin-desktop");

  await guest.goto(app + pastPath);
  await guest.getByRole("heading", { name: "Результаты вечера" }).waitFor();
  assert(!(await guest.locator("main").innerText()).includes(nickname));
  await guest.getByRole("link", { name: "Следующий игровой вечер", exact: true }).click();
  await guest.waitForURL(app + "/evenings");
  await guest.goto(app + "/admin" + pastPath);
  await guest.waitForURL("**/login?error=forbidden");

  const ukrainian = allowCompile(await browser.newPage({ viewport: { width: 375, height: 812 } }));
  await ukrainian.context().addCookies([{ name: "mafia-locale", value: "uk", url: app }]);
  await ukrainian.goto(app + path);
  await text(ukrainian, "Запланований формат · Дев’ятка").waitFor();
  await capture(ukrainian, "evening-guest-uk-phone");

  await admin.goto(app + "/admin" + path);
  await admin.locator("select[name=status]").first().selectOption("cancelled");
  await button(admin, "Сохранить").click();
  await text(admin, "Вечер и приватная заметка сохранены.").waitFor();
  const anonymous = await browser.newPage();
  await anonymous.goto(app + path);
  await text(anonymous, "Плановый формат · Девятка · Отменён").waitFor();
  assert.equal(await anonymous.locator('main a[href^="/register?next="]').count(), 0);
  console.log("PASS: stable invitations, registration return, interest/confirmation/cancel, distinct actual attendance, published results, RU/UK and private admin access.");
} finally {
  await browser.close();
}
