import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const app = process.env.QA_APP_URL || "http://localhost:55420";
const screenshots = process.env.QA_SCREENSHOTS || "/tmp/mafia-communications-qa";
const adminEmail = process.env.QA_ADMIN_EMAIL || "qa-admin@example.test";
const playerEmail = `qa-communications-${Date.now()}@example.test`;
const password = process.env.QA_PASSWORD || "Synthetic-QA-Only-2026";
assert.match(app, /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/, "This test writes only to a local synthetic fixture.");
await mkdir(screenshots, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox"],
});

const button = (page, name) => page.getByRole("button", { name, exact: true });
const open = (page, path) => page.goto(app + path, { waitUntil: "domcontentloaded", timeout: 90_000 });
const consent = (page) => page.getByRole("checkbox", { name: "Новый вечер", exact: true });

async function login(page, email) {
  await open(page, "/login");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await button(page, "Войти").click();
  await page.waitForURL((url) => url.pathname !== "/login");
}

async function screenshot(page, name, viewport) {
  await page.setViewportSize(viewport);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, name);
  await page.screenshot({ path: resolve(screenshots, name + ".png"), fullPage: true, animations: "disabled" });
}

try {
  const guest = await browser.newPage({ viewport: { width: 375, height: 812 } });
  await open(guest, "/club/preferences");
  await guest.waitForURL((url) => url.pathname === "/login");
  await open(guest, "/admin/communications");
  await guest.waitForURL((url) => url.pathname === "/login");

  const player = await browser.newPage({ viewport: { width: 375, height: 812 } });
  await open(player, "/register");
  await player.locator("#nickname").fill("QA Комунікації");
  await player.locator("#email").fill(playerEmail);
  await player.locator("#password").fill(password);
  await button(player, "Зарегистрироваться").click();
  await player.waitForURL((url) => url.pathname === "/evenings");
  await open(player, "/admin/communications");
  await player.waitForURL((url) => url.searchParams.get("error") === "forbidden");
  await open(player, "/club/preferences");
  await consent(player).check();
  await player.getByLabel("Язык уведомлений").selectOption("uk");
  await button(player, "Сохранить настройки").click();
  await player.getByText("Настройки сохранены.", { exact: true }).waitFor();
  await player.getByLabel("Атмосфера", { exact: true }).selectOption("5");
  await player.getByRole("checkbox", { name: "Не подходит расписание" }).check();
  await player.getByRole("checkbox", { name: "Пт", exact: true }).check();
  await player.locator("textarea[name=suggestion]").fill("QA test sustainable club schedule");
  await button(player, "Сохранить ответы").click();
  await player.getByText("Ответы сохранены.", { exact: true }).waitFor();
  await player.reload();
  assert.equal(await player.getByLabel("Атмосфера", { exact: true }).inputValue(), "5");
  assert.equal(await consent(player).isChecked(), true);
  await screenshot(player, "02-player-preferences-phone-ru", { width: 375, height: 812 });

  const admin = await browser.newPage({ viewport: { width: 820, height: 1180 } });
  await login(admin, adminEmail);
  await open(admin, "/admin/communications");
  await admin.getByText("Ответов пока недостаточно для сводки.").waitFor();
  assert.doesNotMatch(await admin.locator("main").innerText(), /QA test sustainable club schedule/u);
  await button(admin, "Посмотреть сообщение").click();
  await admin.getByText(/Mafia League · Призначено новий ігровий вечір/u).waitFor();
  await screenshot(admin, "03-admin-preview-ipad-ru", { width: 820, height: 1180 });
  await button(admin, "Записать симуляцию").click();
  await admin.getByText("Записано симуляций · 1", { exact: true }).waitFor();
  await admin.getByText(/Время симуляции ·/u).first().waitFor();
  await button(admin, "Посмотреть сообщение").click();
  await admin.getByText("Сейчас нет получателей для симуляции.").waitFor();
  assert.equal(await button(admin, "Записать симуляцию").count(), 0);

  await consent(player).uncheck();
  await button(player, "Сохранить настройки").click();
  await player.getByText("Настройки сохранены.", { exact: true }).waitFor();
  await button(player, "Удалить ответы").click();
  await player.getByText("Ответы удалены.", { exact: true }).waitFor();
  await player.reload();
  assert.equal(await consent(player).isChecked(), false);
  assert.equal(await player.getByLabel("Атмосфера", { exact: true }).inputValue(), "");
  assert.equal(await player.locator("textarea[name=suggestion]").inputValue(), "");

  await admin.context().addCookies([{ name: "mafia-locale", value: "uk", url: app }]);
  await admin.reload();
  await admin.getByRole("heading", { name: "Комунікації", exact: true }).waitFor();
  await screenshot(admin, "04-admin-log-desktop-uk", { width: 1440, height: 1000 });
  console.log("Communications browser passed: access, consent, feedback, Ukrainian preview, dry-run ledger and duplicate prevention.");
} finally {
  await browser.close();
}
