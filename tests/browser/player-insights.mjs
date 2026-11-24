import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

const app = process.env.QA_APP_URL || "http://127.0.0.1:55420";
const screenshots = process.env.QA_SCREENSHOTS || "/tmp/mafia-player-insights-qa";
const publicProfile = "/players/00000000-0000-0000-0000-000000000101";
const emptyProfile = "/players/00000000-0000-0000-0000-000000000111";
assert.match(app, /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/, "The suite uses the local synthetic fixture.");
await mkdir(screenshots, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox"],
});
try {
  const viewportChecks = [
    { width: 375, height: 812, locale: "ru", tabs: ["Обзор", "Игровая история", "Игра за столом", "С кем играл"] },
    { width: 820, height: 1180, locale: "uk", tabs: ["Огляд", "Ігрова історія", "Гра за столом", "З ким грав"] },
    { width: 1440, height: 1000, locale: "ru", tabs: ["Обзор", "Игровая история", "Игра за столом", "С кем играл"] },
  ];
  for (const { width, height, locale, tabs } of viewportChecks) {
    const context = await browser.newContext({ viewport: { width, height }, reducedMotion: "reduce" });
    await context.addCookies([{ name: "mafia-locale", value: locale, url: app }]);
    const page = await context.newPage();
    page.setDefaultTimeout(60_000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(app + publicProfile, { timeout: 60_000 });
    await page.getByRole("heading", { name: "Сова", exact: true }).waitFor();
    const nav = page.getByRole("navigation", { name: locale === "uk" ? "Розділи профілю" : "Разделы профиля" });
    for (const [index, label] of tabs.entries()) {
      const link = nav.getByRole("link", { name: label, exact: true });
      if (index !== 0) await link.click();
      await nav.locator('a[aria-current="page"]').filter({ hasText: label }).waitFor();
      const landmark = [
        "League Skill",
        locale === "uk" ? "Історія партій" : "История партий",
        locale === "uk" ? "Місця за столом" : "Места за столом",
      ][index];
      if (landmark) await page.getByRole("heading", { name: landmark, exact: true }).first().waitFor();
      else await page.getByText(locale === "uk" ? "На одній стороні" : "На одной стороне", { exact: true }).first().waitFor();
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${label} overflows at ${width}px`);
      if (index === 1) {
        await page.locator("#gamesPage a[href*='/history/games/']").first().waitFor();
        assert.equal(await page.locator("#attendancePage").count(), 0, "Guests must not see private attendance");
        await page.locator('#gamesPage a[href*="gamesPage=2"]').click();
        await page.waitForURL(/gamesPage=2/);
        await page.locator('#gamesPage a[href*="gamesPage=2"]').count().then((count) => assert.equal(count, 0));
      }
      await page.screenshot({ path: resolve(screenshots, `profile-${width}-${index + 1}.png`), animations: "disabled" });
    }
    if (width === 375) {
      await nav.getByRole("link", { name: tabs[0], exact: true }).click();
      await page.getByRole("heading", { name: "League Skill", exact: true }).waitFor();
      const period = page.locator('select[name="period"]');
      const quarter = await period.locator("option").evaluateAll((options) => options.find((option) => option.value.includes("-q"))?.value);
      assert(quarter);
      await period.selectOption(quarter);
      await page.locator('select[name="format"]').selectOption("short9");
      await page.locator('select[name="role"]').selectOption("red");
      await page.getByRole("button", { name: "Применить", exact: true }).click();
      await page.waitForURL((url) => url.searchParams.get("period") === quarter
        && url.searchParams.get("format") === "short9" && url.searchParams.get("role") === "red");
      await page.goto(app + emptyProfile, { timeout: 60_000 });
      await page.getByText("После опубликованных партий здесь появятся результаты и история.", { exact: true }).waitFor();
    }
    assert.deepEqual(errors, []);
    await context.close();
  }
  const ownerContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const owner = await ownerContext.newPage();
  await owner.goto(app + "/login");
  await owner.locator("#email").fill(process.env.QA_PLAYER_EMAIL || "qa-player@example.test");
  await owner.locator("#password").fill(process.env.QA_PASSWORD || "Synthetic-QA-Only-2026");
  await owner.getByRole("button", { name: "Войти", exact: true }).click();
  await owner.waitForURL((url) => url.pathname !== "/login");
  const profile = await owner.locator('header a[href^="/players/"]').filter({ visible: true }).first().getAttribute("href");
  assert(profile && profile !== emptyProfile);
  await owner.goto(app + profile + "?tab=history");
  await owner.getByRole("heading", { name: "Отмеченное присутствие", exact: true }).waitFor();
  assert.equal(await owner.getByText("Отметки о присутствии временно недоступны.", { exact: true }).count(), 0);
  await owner.goto(app + emptyProfile + "?tab=history");
  await owner.getByRole("heading", { name: "История партий", exact: true }).waitFor();
  assert.equal(await owner.locator("#attendancePage").count(), 0, "A player must not see another player's attendance");
  await ownerContext.close();
  console.log("Player profile passed RU/UK, four tabs, history pagination, combined filters, owner-only attendance and empty state at 375/820/1440px.");
} finally {
  await browser.close();
}
