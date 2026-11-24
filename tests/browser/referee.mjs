import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const app = process.env.QA_APP_URL || "http://localhost:55420";
const screenshots = process.env.QA_SCREENSHOTS || "/tmp/mafia-referee-qa";
const adminEmail = process.env.QA_ADMIN_EMAIL || "qa-admin@example.test";
const playerEmail = process.env.QA_PLAYER_EMAIL || "qa-player@example.test";
const password = process.env.QA_PASSWORD || "Synthetic-QA-Only-2026";
assert.match(app, /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/, "This interactive suite writes only to a local synthetic fixture.");
await mkdir(screenshots, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  headless: true, args: ["--no-sandbox"],
});
const btn = (root, name) => root.getByRole("button", { name, exact: true });
const shot = async (page, name) => page.screenshot({ path: resolve(screenshots, name + ".png"), animations: "disabled" });
const click = (page, name) => btn(page, name).click();
const waitStep = async (page, value) => page.locator('[data-step="' + value + '"]').waitFor();
const seat = (root, number) => root.getByRole("button", { name: new RegExp("^" + number + " · ") });
const dialog = (page) => page.getByRole("dialog");
const next = (page) => click(page, "Далее");

async function fit(page, label) {
  const button = btn(page, label);
  await button.waitFor();
  assert(await button.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight;
  }), "Viewport clips " + label + " at " + JSON.stringify(page.viewportSize()));
}

async function login(context, email) {
  const page = await context.newPage();
  await page.goto(app + "/login");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await click(page, "Войти");
  await page.waitForURL((url) => url.pathname !== "/login");
  return page;
}

async function start(page, short = false, capture = true, stopAtShortCheck = false) {
  await page.getByRole("heading", { name: "Кто сегодня за столом?" }).waitFor();
  if (short) await click(page, "Девятка · 9");
  if (!short) {
    await click(page, "Выбрать из игроков");
    await page.getByRole("combobox", { name: "Ведущий", exact: true }).selectOption({ label: "Ведущий" });
  } else await page.getByPlaceholder("Ник ведущего (необязательно)").fill("QA Гость");
  await click(page, "Подтвердить присутствие записавшихся");
  for (const player of ["Тінь", "Капітан", "Луна", ...(short ? [] : ["Фенікс"])]) await click(page, player);
  await click(page, "Предложить состав");
  await click(page, "Рассадить");
  if (!short && capture) {
    await shot(page, "02-classic-seating-ipad");
    await seat(page, 1).click();
    await seat(page, 2).click();
    await page.getByLabel("Причина", { exact: true }).fill("Проверка перестановки QA");
    await click(page, "Подтвердить обмен мест");
  }
  await click(page, "Подтвердить места");
  await waitStep(page, "roles");
  const civilians = short ? 5 : 6;
  for (let i = civilians; i > 0; i--) await click(page, "Мирный " + i);
  await click(page, "Шериф 1");
  await click(page, "Мафия 2");
  await click(page, "Мафия 1");
  await click(page, "Дон 1");
  await click(page, "Начать нулевую ночь");
  await fit(page, "Запустить таймер");
  await click(page, "Запустить таймер");
  if (!short && capture) await shot(page, "03-classic-n0-ipad");
  await click(page, "Мафия уснула");
  if (short) {
    if (stopAtShortCheck) return waitStep(page, "donCheck");
    await check(page, 6);
    await check(page, 9);
  } else {
    await waitStep(page, "donAck");
    await next(page);
    await waitStep(page, "sheriffAck");
    assert.equal(await page.locator("[data-timer]").textContent(), "00:20");
    await click(page, "Завершить этап");
  }
  await waitStep(page, "seating");
  assert.equal(await page.locator("[data-timer]").textContent(), "00:30");
  await click(page, "Завершить этап");
  await click(page, "Объявить утро");
  await waitStep(page, "speechReady");
}

async function check(page, target = null) {
  await fit(page, "Открыть действие");
  await click(page, "Открыть действие");
  if (target !== null) {
    await seat(dialog(page), target).click();
    await btn(dialog(page), "Подтвердить показанный ответ").click();
  } else {
    const absent = btn(dialog(page), "Роль выбыла");
    if (await absent.isVisible()) await absent.click();
    else await btn(dialog(page), "Цель не названа").click();
  }
  await dialog(page).waitFor({ state: "hidden" });
}

async function speeches(page, nominate = [], callback) {
  await waitStep(page, "speechReady");
  for (let i = 0; i < 10; i++) {
    if (!(await page.locator('[data-step="speechReady"]').count())) break;
    const startWord = await btn(page, "Начать выставление").isVisible() ? "Начать выставление" : "Начать речь";
    await click(page, startWord);
    await waitStep(page, "speech");
    if (nominate[i]) await seat(page, nominate[i]).click();
    if (callback) await callback(i, startWord);
    await fit(page, "Закончить речь");
    await click(page, "Закончить речь");
    await page.locator('[data-step="speechReady"],[data-step="voteReady"]').waitFor();
  }
  await waitStep(page, "voteReady");
}

async function ballot(page, votes) {
  for (const vote of votes) await click(page, String(vote));
  await click(page, "Подтвердить подсчёт");
}

async function noVote(page) {
  await click(page, "Перейти к итогам дня");
  await click(page, "Объявить итог дня");
  await click(page, "Начать ночь");
}

async function finishDayExit(page) {
  await click(page, "Перейти к итогам дня");
  await click(page, "Объявить итог дня");
  await waitStep(page, "last");
  await click(page, "Завершить этап");
}

async function saveResult(page, networkLoss = false) {
  await click(page, "Подтвердить результат");
  await waitStep(page, "review");
  if (networkLoss) {
    await page.context().setOffline(true);
    await click(page, "Отправить на проверку");
    await page.getByText("Ждёт отправки", { exact: true }).waitFor();
    await shot(page, "07-offline-outbox-phone");
    await page.reload();
    await waitStep(page, "review");
    await page.getByText("Ждёт отправки", { exact: true }).waitFor();
    await page.context().setOffline(false);
  }
  const request = page.waitForResponse((res) => res.url().endsWith("/api/referee/draft") &&
    res.request().postDataJSON().action === "submit");
  await click(page, "Отправить на проверку");
  const response = await request;
  assert.equal(response.ok(), true, JSON.stringify(await response.json()));
  const sent = response.request().postDataJSON();
  await page.getByText("На проверке", { exact: true }).waitFor();
  const retry = await page.request.post(app + "/api/referee/draft", { data: sent });
  assert.equal(retry.status(), 200);
  assert.deepEqual(await retry.json(), await response.json());
  const wrong = await page.request.post(app + "/api/referee/draft", {
    data: { action: "read", id: sent.id, secret: "0".repeat(64), revision: 0 },
  });
  assert.equal(wrong.status(), 403);
  const malformed = await page.request.post(app + "/api/referee/draft", { data: { ...sent, payload: { ...sent.payload, events: [] } } });
  assert.equal(malformed.status(), 422);
  return sent;
}

if (process.env.QA_ACCEPTANCE_ONLY === "1" || process.env.QA_CAPTURE_BASELINE === "1") {
  try { await acceptance(process.env.QA_CAPTURE_BASELINE === "1"); }
  finally { await browser.close(); }
  process.exit(0);
}

if (process.env.QA_EDGE_ONLY === "1") {
  try { await edgeScenarios(); await clubRegression(); }
  finally { await browser.close(); }
  process.exit(0);
}

try {
  const guest = await browser.newContext({ viewport: { width: 820, height: 1180 }, isMobile: true, hasTouch: true });
  const page = await guest.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(app + "/");
  await page.getByRole("link", { name: "Вести игру", exact: true }).first().click();
  await page.waitForURL("**/referee");
  await page.reload();
  await page.getByRole("heading", { name: "Кто сегодня за столом?" }).waitFor();
  await shot(page, "01-guest-evening-ipad");
  await start(page);
  await page.evaluate(() => document.fonts.ready);
  await speeches(page, [1, 2], async (i, label) => {
    if (i === 0) {
      await click(page, "Пауза");
      const paused = await page.locator("[data-timer]").textContent();
      await page.waitForTimeout(550);
      assert.equal(await page.locator("[data-timer]").textContent(), paused);
      await click(page, "Продолжить");
      await shot(page, "04-classic-speech-ipad");
      for (const viewport of [{ width: 768, height: 1024 }, { width: 1180, height: 820 }, { width: 390, height: 844 }]) {
        await page.setViewportSize(viewport);
        await fit(page, "Закончить речь");
        await fit(page, "Фол");
      }
      await page.setViewportSize({ width: 820, height: 1180 });
      for (let n = 0; n < 3; n++) {
        await click(page, "Фол");
        await seat(dialog(page), 3).click();
        await btn(dialog(page), "Обычный фол").click();
      }
      assert(await btn(page, "Пауза").isVisible());
      await click(page, "Ещё");
      await btn(dialog(page), "Сохранить в облако").click();
      await page.getByText("В облаке", { exact: true }).waitFor();
      await click(page, "Ещё");
      await btn(dialog(page), "Показать код восстановления").click();
      const code = await dialog(page).getByRole("textbox").inputValue();
      await btn(dialog(page), "×").click();
      const device = await browser.newContext();
      const restored = await device.newPage();
      await restored.goto(app + "/referee");
      await click(restored, "Восстановить черновик");
      await dialog(restored).getByLabel("Закрытый код облачной копии").fill(code);
      await btn(dialog(restored), "Восстановить черновик").click();
      await waitStep(restored, "speech");
      assert.equal(await restored.getByText("В облаке", { exact: true }).count(), 1);
      await device.close();
      await page.bringToFront();
      const other = await guest.newPage();
      await other.goto(app + "/referee");
      await waitStep(other, "speech");
      await page.bringToFront();
      await click(page, "Пауза").catch(() => undefined);
      await click(page, "Ещё");
      await btn(dialog(page), "Добавить пояснение").click();
      await dialog(page).getByLabel("Причина").fill("Техническая заметка QA");
      await btn(dialog(page), "Далее").click();
      await dialog(page).waitFor({ state: "hidden" });
      await other.bringToFront();
      await click(other, "Закончить речь");
      await other.getByText("Черновик изменён в другой вкладке.", { exact: false }).waitFor();
      await other.close();
      await page.bringToFront();
      await page.reload();
      await waitStep(page, "speech");
      assert.notEqual(await page.locator("[data-timer]").textContent(), "");
    }
    if (i === 2) {
      assert.equal(label, "Начать выставление");
      assert.equal(await page.locator("[data-timer]").textContent(), "00:10");
    }
  });
  await click(page, "Начать подсчёт");
  await fit(page, "0");
  await shot(page, "05-vote-palette-ipad");
  await ballot(page, [5, 5]);
  await waitStep(page, "defense");
  await click(page, "Завершить этап");
  await click(page, "Завершить этап");
  await ballot(page, [5, 5]);
  await click(page, "0");
  await click(page, "Подтвердить голосование");
  await click(page, "Объявить итог дня");
  await click(page, "Начать ночь");
  await seat(page, 8).click();
  await click(page, "Подтвердить цель");
  assert(!await page.getByText("Проверка Дона", { exact: true }).count());
  await check(page, 7);
  await check(page, 8);
  await click(page, "Подвести итог ночи");
  await waitStep(page, "best");
  for (const target of [1, 9, 10]) await seat(page, target).click();
  await click(page, "Подтвердить три места");
  await click(page, "Объявить утро");
  await waitStep(page, "last");
  await click(page, "Завершить этап");
  await speeches(page, [9]);
  await finishDayExit(page);
  await click(page, "Начать ночь");
  await seat(page, 10).click();
  await click(page, "Подтвердить цель");
  await check(page, 7);
  await check(page, 10);
  await click(page, "Подвести итог ночи");
  await click(page, "Объявить утро");
  await click(page, "Завершить этап");
  await page.getByText("Победа красных", { exact: true }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  const classic = await saveResult(page, true);

  const denied = await guest.newPage();
  await denied.goto(app + "/admin/referee/inbox");
  await denied.waitForURL("**/login");
  await denied.close();

  const large = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const admin = await login(large, adminEmail);
  await admin.goto(app + "/admin/referee/inbox");
  await admin.locator(`a[href="/admin/referee/inbox/${classic.id}"]`).click();
  await admin.getByRole("heading", { name: "Проверьте протокол" }).waitFor();
  await shot(admin, "08-admin-review-desktop");
  await admin.getByLabel("Я проверил наблюдения и причины исправлений").check();
  await click(admin, "Утвердить и опубликовать");
  await admin.getByRole("link", { name: "Открыть игру" }).waitFor();
  const classicGame = await admin.getByRole("link", { name: "Открыть игру" }).getAttribute("href");
  await admin.reload();
  assert.equal(await admin.getByRole("link", { name: "Открыть игру" }).getAttribute("href"), classicGame);
  assert.equal(await btn(admin, "Утвердить и опубликовать").count(), 0);
  await admin.getByRole("link", { name: "Открыть игру" }).click();
  await admin.getByText("Победа красных", { exact: false }).first().waitFor({ timeout: 10000 }).catch(async () => {
    assert((await admin.locator("main").textContent()).includes("Красные"));
  });

  const ordinary = await browser.newContext();
  const player = await login(ordinary, playerEmail);
  await player.goto(app + "/admin/referee/inbox/" + classic.id);
  await player.waitForURL("**/login?error=forbidden");

  await click(page, "Следующая партия");
  await page.getByRole("heading", { name: "Кто сегодня за столом?" }).waitFor();
  await click(page, "Взять тот же состав");
  await page.getByRole("heading", { name: "Состав партии" }).waitFor();
  await shot(page, "09-next-game-phone");
  const phone = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
  const short = await phone.newPage();
  await short.goto(app + "/referee");
  await click(short, "Восстановить черновик");
  const historic = {
    schema: "mafia-league-referee-protocol-v1",
    draftId: "qa-historical-short",
    clientRevision: 0,
    gameStartAt: "2026-10-19T10:00:00Z",
    timezone: "Europe/Vienna",
    normativeRegulationId: "mafia-league-game-regulations-v1-2026-10-18",
    format: "short9", title: "Синтетический исторический протокол",
    seats: Array.from({ length: 9 }, (_, i) => ({ number: i + 1, localNickname: "QA " + (i + 1), role: null })),
    events: [], status: "draft",
  };
  const canonical = (data) => Array.isArray(data) ? "[" + data.map(canonical).join(",") + "]"
    : data && typeof data === "object" ? "{" + Object.keys(data).sort().map((key) => JSON.stringify(key) + ":" + canonical(data[key])).join(",") + "}"
      : JSON.stringify(data);
  const digest = createHash("sha256").update(canonical(historic)).digest("hex");
  await dialog(short).getByLabel("JSON").setInputFiles({
    name: "historic-demo.json", mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ payload: historic, sha256: digest })),
  });
  await short.getByRole("heading", { name: "Исторический протокол" }).waitFor();
  await click(short, "Назад");
  await start(short, true);
  await shot(short, "06-short9-first-speech-phone");
  await speeches(short);
  await noVote(short);
  await waitStep(short, "donCheck");
  assert(!await short.getByRole("button", { name: "Промах", exact: true }).count());
  await check(short, 6);
  await check(short, 9);
  await click(short, "Подвести итог ночи");
  await click(short, "Объявить утро");
  await speeches(short, [7]);
  await finishDayExit(short);
  await click(short, "Начать ночь");
  await waitStep(short, "shot");
  await seat(short, 8).click();
  await click(short, "Подтвердить цель");
  await check(short, 6);
  await check(short, 9);
  await click(short, "Подвести итог ночи");
  await waitStep(short, "morning");
  await click(short, "Объявить утро");
  await click(short, "Завершить этап");
  await speeches(short, [9]);
  await finishDayExit(short);
  const shortRecord = await saveResult(short);

  await admin.goto(app + "/admin/referee/inbox/" + shortRecord.id);
  await admin.getByRole("heading", { name: "Проверьте протокол" }).waitFor();
  await admin.getByLabel("Причина", { exact: true }).fill("Уточните наблюдение QA");
  await click(admin, "Запросить уточнение");
  await admin.getByText("Нужно уточнение", { exact: true }).waitFor();
  await click(short, "Проверить статус и версию");
  await short.getByText("Нужно уточнение", { exact: true }).waitFor();
  await click(short, "Ещё");
  await btn(dialog(short), "Добавить пояснение").click();
  await dialog(short).getByLabel("Причина", { exact: true }).fill("Проверено на записи QA");
  await btn(dialog(short), "Далее").click();
  await dialog(short).waitFor({ state: "hidden" });
  await saveResultAfterClarification(short);
  await admin.reload();
  await admin.getByLabel("Причина", { exact: true }).fill("Состав и наблюдения сверены QA");
  await click(admin, "Добавить пояснение");
  await admin.getByText("Состав и наблюдения сверены QA", { exact: true }).first().waitFor();
  await admin.getByLabel("Я проверил наблюдения и причины исправлений").check();
  await click(admin, "Утвердить и опубликовать");
  await admin.getByRole("link", { name: "Открыть игру" }).waitFor();
  const shortGame = await admin.getByRole("link", { name: "Открыть игру" }).getAttribute("href");
  assert.notEqual(classicGame, shortGame);
  await admin.getByRole("link", { name: "Открыть игру" }).click();
  await admin.getByText(/Без основного League Skill/).first().waitFor();
  await click(short, "Следующая партия");
  await short.getByRole("heading", { name: "Кто сегодня за столом?" }).waitFor();
  await click(short, "Взять тот же состав");
  await short.getByRole("heading", { name: "Состав партии" }).waitFor();

  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto(app + "/referee");
  await page.getByRole("button", { name: "Українська" }).click();
  await page.getByRole("heading", { name: "Вести гру" }).waitFor();
  await shot(page, "10-ukrainian-ipad");
  await page.goto(app + "/learn");
  await page.getByRole("heading", { name: "Шлях новачка" }).waitFor();
  await page.getByRole("button", { name: /Як проходить партія/ }).click();
  await page.getByText(/Відстріл доступний із N1/).waitFor();
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ classicGame, shortGame, paths: ["guest", "administrator", "ordinary", "offline", "conflict", "retry", "correction", "locale", "legacy JSON", "cloud restore", "orientation"], screenshots }, null, 2));
} finally {
  await browser.close();
}

async function saveResultAfterClarification(page) {
  const res = page.waitForResponse((r) => r.url().endsWith("/api/referee/draft") && r.request().postDataJSON().action === "submit");
  await click(page, "Отправить на проверку");
  const response = await res;
  assert.equal(response.ok(), true, JSON.stringify(await response.json()));
  await page.getByText("На проверке", { exact: true }).waitFor();
}

async function edgeScenarios() {
  const host = await browser.newContext({ viewport: { width: 768, height: 1024 }, isMobile: true, hasTouch: true });
  const page = await host.newPage();
  await page.goto(app + "/referee");
  await start(page, false, false);
  await page.clock.install({ time: new Date() });
  await click(page, "Начать речь");
  await waitStep(page, "speech");
  await page.waitForFunction(() => document.querySelector("[data-timer]")?.textContent === "01:00");
  await page.clock.fastForward(62_000);
  await page.getByText("Время вышло", { exact: true }).waitFor();
  assert.equal(await page.locator("[data-timer]").textContent(), "00:00");
  await fit(page, "Закончить речь");

  for (let i = 0; i < 4; i++) {
    await click(page, "Фол");
    await seat(dialog(page), 5).click();
    await btn(dialog(page), "Обычный фол").click();
    await dialog(page).waitFor({ state: "hidden" });
  }
  await page.getByText("Голосование отменено", { exact: true }).waitFor();
  await waitStep(page, "speech");
  await click(page, "Ещё");
  await btn(dialog(page), "Отменить действие").click();
  await dialog(page).waitFor({ state: "hidden" });
  assert.equal(await page.getByText("Голосование отменено", { exact: true }).count(), 0);
  await click(page, "Ещё");
  await btn(dialog(page), "Повторить действие").click();
  await page.getByText("Голосование отменено", { exact: true }).waitFor();
  await click(page, "Ещё");
  await btn(dialog(page), "Исправить карты двух мест").click();
  await seat(dialog(page), 1).click();
  await seat(dialog(page), 7).click();
  await dialog(page).getByLabel("Причина").fill("Проверка исправления карт QA");
  await btn(dialog(page), "Сохранить исправление").click();
  await dialog(page).waitFor({ state: "hidden" });
  await click(page, "Ещё");
  await btn(dialog(page), "Закрытые сведения").click();
  await dialog(page).getByText(/Шериф/).first().waitFor();
  const tab = await host.newPage();
  await tab.goto(app + "/");
  await tab.bringToFront();
  // Headless Chromium may keep both targets foregrounded. Exercise the DOM
  // event separately when the browser has not issued it on the tab switch.
  if (await dialog(page).isVisible() && await page.evaluate(() => !document.hidden && document.hasFocus())) {
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  }
  await dialog(page).waitFor({ state: "hidden" });
  await tab.close();

  await page.bringToFront();
  await click(page, "Ещё");
  const downloading = page.waitForEvent("download");
  await btn(dialog(page), "Скачать приватный JSON").click();
  const file = await downloading;
  assert.match(file.suggestedFilename(), /^mafia-protocol-.*\.json$/);
  const copy = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const recovery = await copy.newPage();
  await recovery.goto(app + "/referee");
  await click(recovery, "Восстановить черновик");
  await dialog(recovery).getByLabel("JSON").setInputFiles(await file.path());
  await waitStep(recovery, "speech");
  await recovery.getByText("Голосование отменено", { exact: true }).waitFor();
  await copy.close();
  await host.close();
  console.log("PASS: expiry, iPad viewport, four fouls mid-speech, undo/redo, role correction, privacy on tab switch, and portable current JSON.");
}

async function clubRegression() {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const serial = Date.now();
  const nickname = "QA Кириллица " + serial;
  await page.goto(app + "/register");
  await page.locator("#nickname").fill(nickname);
  await page.locator("#email").fill("qa-new-" + serial + "@example.test");
  await page.locator("#password").fill(password);
  await click(page, "Зарегистрироваться");
  await page.waitForURL("**/evenings");
  await click(page, "Приду");
  await page.getByText("Вы записаны: придёте вовремя.").waitFor();
  await click(page, "Возможно");
  await page.getByText("Отмечено: возможно, придёте.").waitFor();
  await click(page, "Отменить запись");
  await page.getByText("Запись отменена.").waitFor();
  await page.goto(app + "/");
  await page.getByRole("link", { name: "Мой профиль" }).click();
  await page.getByRole("heading", { name: nickname }).waitFor();
  await page.goto(app + "/rating");
  await page.getByRole("heading", { name: "Рейтинг игроков" }).waitFor();
  await page.getByRole("table").waitFor();
  await click(page, "Выйти");
  await page.waitForURL(app + "/");
  await context.close();
  console.log("PASS: registration with Cyrillic, RSVP going/maybe/cancel, signed-in home, profile, Skill and sign-out.");
}

async function acceptance(baseline) {
  const prefix = baseline ? "before" : "after";
  const context = await browser.newContext({ viewport: { width: 820, height: 1180 }, isMobile: true, hasTouch: true });
  await context.addInitScript(() => {
    // Freeze the synthetic draw for matched screenshots. IDs and recovery tokens still use normal crypto.
    const getRandomValues = crypto.getRandomValues.bind(crypto);
    let sample = 20261124;
    crypto.getRandomValues = (array) => {
      if (!(array instanceof Uint32Array) || array.length !== 1) return getRandomValues(array);
      sample = (Math.imul(1664525, sample) + 1013904223) >>> 0;
      array[0] = sample;
      return array;
    };
  });
  const page = await context.newPage();
  await page.goto(app + "/referee");
  await start(page, false, false);
  await page.clock.install();
  await click(page, "Начать речь");
  await waitStep(page, "speech");
  await page.waitForFunction(() => document.querySelector("[data-timer]")?.textContent === "01:00");
  await seat(page, 4).click();
  for (let n = 1; n <= 3; n++) {
    await sanction(page, 3);
    if (!baseline) {
      const announcement = ["Первый фол.", "Второй фол.", "Третий фол."][n - 1];
      await sameText(page.locator("[data-discipline-notice] strong"), new RegExp("№3.*" + announcement));
      await disciplineCount(page, 3, n, 0);
    }
  }
  const time = page.locator("[data-timer]");
  const clockPanel = time.locator("xpath=../..");
  const to = async (elapsed) => {
    const diff = await page.evaluate((target) => {
      const id = JSON.parse(localStorage["mafia.guided.active"]);
      const draft = JSON.parse(localStorage["mafia.guided.draft." + id]).draft;
      const event = draft.events.findLast(({ action }) => action.type === "speechStart");
      const saved = JSON.parse(localStorage["mafia.guided.clock." + id + "." + event.id]);
      return target - (saved.elapsed + Date.now() - saved.wall);
    }, elapsed);
    assert(diff > 0, "The simulated clock already passed the requested boundary");
    await page.clock.fastForward(diff);
  };
  await to(49_150);
  await sameText(time, "00:11");
  const normal = await clockPanel.evaluate((el) => getComputedStyle(el).backgroundColor);
  if (!baseline) assert.equal(await clockPanel.getAttribute("data-timer-state"), "normal");
  await page.clock.fastForward(1000);
  await sameText(time, "00:10");
  if (!baseline) {
    await sameText(page.locator(".ref-time-warning"), "Последние 10 секунд");
    assert.equal(await clockPanel.getAttribute("data-timer-state"), "warning");
    assert.notEqual(await clockPanel.evaluate((el) => getComputedStyle(el).backgroundColor), normal);
    await checkContrast(time, clockPanel);
    await order(page, "[data-nominations]", [4]);
    await page.locator(".ref-seat.speaking[data-seat='1']").waitFor();
    await sameText(page.locator(".ref-following"), /Следующий · №2/);
    await page.locator("[data-seat='3'] .ref-seat-debt").waitFor();
  }
  await page.evaluate(() => document.fonts.ready);
  await shot(page, prefix + "-speech-ipad");
  if (!baseline) {
    await click(page, "Пауза");
    await page.clock.fastForward(4000);
    await sameText(time, "00:10");
    await click(page, "Продолжить");
    await page.clock.fastForward(9000);
    await sameText(time, "00:01");
    await page.clock.fastForward(1000);
    await sameText(time, "00:00");
    await sameText(page.locator(".ref-time-warning"), "Время вышло");
    assert.equal(await clockPanel.getAttribute("data-timer-state"), "expired");
    assert.notEqual(await clockPanel.evaluate((el) => getComputedStyle(el).backgroundColor), normal);
    await waitStep(page, "speech");
    await disciplineCount(page, 1, 0, 0);
    await btn(page.locator("[data-discipline-notice]"), "Отменить действие").click();
    await disciplineCount(page, 3, 2, 0);
    await undoRedo(page, "Повторить действие");
    await disciplineCount(page, 3, 3, 0);
    await page.reload();
    await waitStep(page, "speech");
    await sameText(time, "00:00");
    await page.getByText("Проверьте остаток после восстановления", { exact: true }).waitFor();
    await order(page, "[data-nominations]", [4]);
    await disciplineCount(page, 3, 3, 0);
  }
  await click(page, "Закончить речь");
  await click(page, "Начать речь");
  await seat(page, 2).click();
  await click(page, "Закончить речь");
  if (!baseline) {
    await sameText(page.locator("[data-speech-debt]"), "Третий фол · 10 секунд только на выставление");
    await order(page, "[data-nominations]", [4, 2]);
    await shot(page, "after-debt-ipad");
  }
  await click(page, "Начать выставление");
  await seat(page, 9).click();
  if (!baseline) {
    await sameText(time, "00:10");
    await page.clock.fastForward(4000);
    await sameText(time, "00:06");
    assert.equal(await clockPanel.getAttribute("data-timer-state"), "normal");
    await page.clock.fastForward(1000);
    await sameText(time, "00:05");
    await sameText(page.locator(".ref-time-warning"), "Последние 5 секунд");
    await order(page, "[data-nominations]", [4, 2, 9]);
  }
  await click(page, "Закончить речь");
  await speeches(page);
  await click(page, "Начать подсчёт");
  await click(page, "0");
  if (!baseline) {
    await order(page, "[data-vote-order]", [4, 2, 9]);
    await sameText(page.locator("[data-vote-order] [data-vote-count]").first(), "0");
    await sameText(page.locator("[data-vote-order] li[aria-current] [data-vote-count]"), "Не записано");
    await page.getByText("Осталось голосов 10", { exact: true }).waitFor();
    await shot(page, "after-vote-ipad");
    await undoRedo(page, "Отменить действие");
    await sameText(page.locator("[data-vote-order] [data-vote-count]").first(), "Не записано");
    await undoRedo(page, "Повторить действие");
    await sameText(page.locator("[data-vote-order] [data-vote-count]").first(), "0");
  }
  await ballot(page, [5, 5]);
  await waitStep(page, "defense");
  if (!baseline) {
    await order(page, "[data-nominations]", [4, 2, 9]);
    await order(page, "[data-vote-order]", [2, 9]);
  }
  await click(page, "Завершить этап");
  await click(page, "Завершить этап");
  if (!baseline) {
    await page.locator("[data-vote-stage='2']").waitFor();
    await order(page, "[data-vote-order]", [2, 9]);
    await sanction(page, 6, "technical");
    await sameText(page.locator("[data-discipline-notice] strong"), /Первое техническое предупреждение/);
    await disciplineCount(page, 6, 0, 1);
    await order(page, "[data-vote-order]", [2, 9]);
  }
  await ballot(page, [5, 5]);
  await click(page, "0");
  await click(page, "Подтвердить голосование");
  await click(page, "Объявить итог дня");
  await click(page, "Начать ночь");
  await seat(page, 9).click();
  await click(page, "Подтвердить цель");
  if (!baseline) {
    await click(page, "Открыть действие");
    await page.keyboard.press("Tab");
    const focusRing = await dialog(page).locator(":focus-visible").evaluate((el) => {
      const { outlineStyle, outlineWidth } = getComputedStyle(el);
      return { outlineStyle, outlineWidth };
    });
    assert.equal(focusRing.outlineStyle, "solid");
    assert(parseFloat(focusRing.outlineWidth) >= 2);
    await seat(dialog(page), 7).click();
    await sameText(dialog(page).locator(".ref-answer span"), "Шериф");
    for (const n of [1, 8, 9]) {
      await seat(dialog(page), n).click();
      await sameText(dialog(page).locator(".ref-answer span"), "Не шериф");
    }
    assert(await seat(dialog(page), 10).isDisabled());
    await page.keyboard.press("Escape");
    await dialog(page).waitFor({ state: "detached" });
    assert(await btn(page, "Открыть действие").evaluate((el) => el === document.activeElement));
  }
  await check(page, 7);
  await click(page, "Открыть действие");
  if (!baseline) {
    for (const [n, word] of [[1, "Красный"], [8, "Чёрный"], [10, "Чёрный"]]) {
      await seat(dialog(page), n).click();
      await sameText(dialog(page).locator(".ref-answer span"), word);
    }
    assert(await seat(dialog(page), 7).isDisabled());
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await dialog(page).waitFor({ state: "detached" });
    assert(!await page.getByText(/Красный|Чёрный|Мирный|Шериф|Победа/).count());
    await click(page, "Открыть действие");
  }
  await seat(dialog(page), 9).click(); // Pending shot remains a legal target until dawn.
  if (!baseline) await sameText(dialog(page).locator(".ref-answer span"), "Чёрный");
  await shot(page, prefix + "-sheriff-ipad");
  await btn(dialog(page), "Подтвердить показанный ответ").click();
  if (!baseline) {
    await click(page, "Ещё");
    await btn(dialog(page), "Исправить карты двух мест").click();
    await seat(dialog(page), 1).click();
    await seat(dialog(page), 9).click();
    await dialog(page).getByLabel("Причина").fill("Синтетическое уточнение роли");
    await btn(dialog(page), "Сохранить исправление").click();
    await click(page, "Ещё");
    await btn(dialog(page), "Журнал").click();
    await dialog(page).getByText("№9 · Чёрный", { exact: true }).waitFor();
    assert(!await dialog(page).getByText(/Победа/).count());
    await page.keyboard.press("Escape");
    await click(page, "Подвести итог ночи");
    await waitStep(page, "best");
    for (const n of [1, 8, 10]) await seat(page, n).click();
    await click(page, "Подтвердить три места");
    await click(page, "Объявить утро");
    await waitStep(page, "last");
    await click(page, "Фол");
    assert(await seat(dialog(page), 9).isDisabled(), "An eliminated speaker cannot be sanctioned");
    await btn(dialog(page), "×").click();
    await sanction(page, 6, "technical");
    await page.getByText("Следующее голосование отменено", { exact: true }).waitFor();
    await waitStep(page, "last");
    await sameText(page.locator(".ref-arena [data-seat='9'] .ref-seat-exit"), "Выбыл");
  }
  await context.close();
  await catalogAcceptance(baseline);
  if (!baseline) await shortAcceptance();
  console.log(baseline ? "Captured matched baseline states." : "PASS: acceptance DOM, layout, localization, timers, discipline, votes, privacy and catalog.");
}

async function sanction(page, n, kind = "ordinary") {
  await click(page, "Фол");
  const sheet = dialog(page);
  await seat(sheet, n).click();
  if (kind === "ordinary") await btn(sheet, "Обычный фол").click();
  else {
    const label = kind === "technical" ? "Техническое предупреждение" : "Удалить";
    await btn(sheet, label).click();
    await sheet.getByLabel("Причина").fill("Синтетическое нарушение, проверка интерфейса");
    await btn(sheet, label).last().click();
  }
  await sheet.waitFor({ state: "detached" });
}

async function undoRedo(page, action) {
  await click(page, "Ещё");
  await btn(dialog(page), action).click();
  await dialog(page).waitFor({ state: "detached" });
}

async function sameText(locator, expected) {
  await locator.waitFor();
  if (expected instanceof RegExp) assert.match((await locator.textContent()).trim(), expected);
  else await locator.getByText(expected, { exact: true }).or(locator.filter({ hasText: new RegExp("^" + expected + "$") })).first().waitFor();
}

async function order(page, list, numbers) {
  const items = page.locator(list + " li");
  await items.first().waitFor();
  assert.deepEqual(await items.evaluateAll((nodes) => nodes.map((node) => Number(node.dataset.candidate))), numbers);
}

async function disciplineCount(page, n, fouls, technical) {
  const place = page.locator(".ref-arena [data-seat='" + n + "']");
  await place.locator("[data-fouls='" + fouls + "']").waitFor();
  await place.locator("[data-technical='" + technical + "']").waitFor();
  assert((await place.getAttribute("aria-label")).includes(fouls + "/4"));
  assert((await place.getAttribute("aria-label")).includes(technical + "/2"));
}

async function checkContrast(text, background) {
  const luminance = (color) => color.match(/\d+/g).slice(0, 3).map((n) => Number(n) / 255)
    .map((n) => n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4)
    .reduce((sum, n, channel) => sum + n * [0.2126, 0.7152, 0.0722][channel], 0);
  const a = luminance(await text.evaluate((el) => getComputedStyle(el).color));
  const b = luminance(await background.evaluate((el) => getComputedStyle(el).backgroundColor));
  assert((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) >= 4.5);
}

async function catalogAcceptance(baseline) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const catalog = await (await page.request.get(app + "/api/referee/catalog")).json();
  assert(catalog.evenings.length > 0, "QA requires a planned event");
  assert(catalog.evenings.every((item) => !/^(STALE|CANCELLED)/.test(item.place)));
  assert(!JSON.stringify(catalog).includes("PRIVATE SYNTHETIC ORGANIZER NOTE"));
  const empty = { ...catalog, evenings: [] };
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let mode = "wait";
  await context.route("**/api/referee/catalog", async (route) => {
    if (mode === "wait") await gate;
    return mode === "fail" ? route.fulfill({ status: 503, json: { error: "unavailable" } })
      : mode === "back" ? route.continue() : route.fulfill({ json: empty });
  });
  await page.goto(app + "/referee", { waitUntil: "domcontentloaded" });
  if (!baseline) await page.getByRole("heading", { name: "Ищем игровые вечера" }).waitFor();
  release();
  await page.getByText(/^Нет доступного вечера/).waitFor();
  await page.evaluate(() => document.fonts.ready);
  await shot(page, baseline ? "before-empty-phone" : "after-empty-phone");
  if (!baseline) {
    const shell = page.locator(".ref-shell");
    assert.equal(await shell.getByRole("link", { name: "Игры", exact: true }).getAttribute("href"), "/evenings");
    assert.equal(await shell.getByRole("link", { name: "Mafia League", exact: true }).getAttribute("href"), "/");
    assert.equal(await shell.getByRole("link", { name: "Новый вечер" }).count(), 0);
    await btn(shell, "Восстановить черновик").click();
    await dialog(page).getByLabel("JSON").waitFor();
    await page.keyboard.press("Escape");
    mode = "fail";
    await click(page, "Обновить список");
    await page.getByRole("heading", { name: "Не удалось загрузить вечера" }).waitFor();
    await page.evaluate(() => localStorage.removeItem("mafia.guided.catalog"));
    await context.setOffline(true);
    await page.getByRole("heading", { name: "Список вечеров недоступен без сети" }).waitFor();
    mode = "back";
    await context.setOffline(false);
    await page.getByRole("heading", { name: "Кто сегодня за столом?" }).waitFor();
    await context.setOffline(true);
    await page.getByText(/Список вечеров сохранён/).waitFor();
    await page.getByRole("heading", { name: "Кто сегодня за столом?" }).waitFor();
    await context.setOffline(false);
    mode = "empty";

    const admin = await login(context, adminEmail);
    await admin.goto(app + "/referee");
    await admin.locator(".ref-entry").getByRole("link", { name: "Новый вечер" }).waitFor();
    const ordinary = await login(context, playerEmail);
    await ordinary.goto(app + "/referee");
    await ordinary.getByRole("heading", { name: "Нет доступного вечера" }).waitFor();
    assert.equal(await ordinary.locator(".ref-entry a[href='/admin/evenings']").count(), 0);
  }
  await context.close();
}

async function shortAcceptance() {
  const context = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await page.goto(app + "/referee");
  await start(page, true, false, true);
  await context.addCookies([{ name: "mafia-locale", value: "uk", url: app }]);
  await page.reload();
  await waitStep(page, "donCheck");
  await page.clock.install();
  await click(page, "Відкрити дію");
  await sameText(page.locator("[data-timer]"), "00:20");
  await page.clock.fastForward(14_000);
  await sameText(page.locator("[data-timer]"), "00:06");
  assert.equal(await page.locator(".ref-time").getAttribute("data-timer-state"), "normal");
  await page.clock.fastForward(1000);
  await sameText(page.locator(".ref-time-warning"), "Останні 5 секунд");
  await seat(dialog(page), 6).click();
  await sameText(dialog(page).locator(".ref-answer span"), "Шериф");
  await seat(dialog(page), 1).click();
  await sameText(dialog(page).locator(".ref-answer span"), "Не шериф");
  await btn(dialog(page), "Не встановлено").click();
  await click(page, "Відкрити дію");
  await seat(dialog(page), 1).click();
  await sameText(dialog(page).locator(".ref-answer span"), "Червоний");
  await seat(dialog(page), 9).click();
  await sameText(dialog(page).locator(".ref-answer span"), "Чорний");
  await checkSeats(page, 9, dialog(page));
  await shot(page, "after-short9-uk-n0-phone");
  await btn(dialog(page), "Підтвердити показану відповідь").click();
  await click(page, "Завершити етап");
  await click(page, "Оголосити ранок");
  await context.addCookies([{ name: "mafia-locale", value: "ru", url: app }]);
  await page.reload();
  await waitStep(page, "speechReady");
  for (let i = 0; i < 3; i++) await sanction(page, 2);
  await sanction(page, 8, "technical");
  await disciplineCount(page, 8, 0, 1);
  await sanction(page, 8, "technical");
  await disciplineCount(page, 8, 0, 2);
  await sameText(page.locator(".ref-arena [data-seat='8'] .ref-seat-exit"), "Удалён");
  await page.getByText("Голосование отменено", { exact: true }).waitFor();
  await page.getByText(/Удаление без последнего слова/).waitFor();
  for (const n of [7, 4, 5, 6]) await sanction(page, n, "remove");
  for (const viewport of [{ width: 375, height: 812 }, { width: 390, height: 844 }, { width: 768, height: 1024 },
    { width: 820, height: 1180 }, { width: 1180, height: 820 }, { width: 1440, height: 1000 }]) {
    await page.setViewportSize(viewport);
    await fit(page, "Начать речь");
    await fit(page, "Фол");
    await checkSeats(page, 9);
  }
  await click(page, "Начать речь");
  await click(page, "Закончить речь");
  await sameText(page.locator("[data-speech-debt]"), "Третий фол · 30 секунд на речь");
  await click(page, "Начать речь");
  await sameText(page.locator("[data-timer]"), "00:30");
  await shot(page, "after-short9-discipline-desktop");
  await click(page, "Закончить речь");
  await click(page, "Начать речь");
  await click(page, "Закончить речь");
  await click(page, "Начать речь");
  await click(page, "Закончить речь");
  await click(page, "Объявить итог дня");
  await click(page, "Начать ночь");
  await waitStep(page, "donCheck");
  assert.equal(await btn(page, "Промах").count(), 0);
  await check(page);
  await check(page);
  await click(page, "Подвести итог ночи");
  await click(page, "Объявить утро");
  assert(!await page.locator("[data-speech-debt]").count(), "The served debt cannot be consumed twice");
  await click(page, "Начать речь");
  await sameText(page.locator("[data-timer]"), "01:00");
  await context.close();
}

async function checkSeats(page, expected, root = page.locator(".ref-arena")) {
  const geometry = await root.locator(".ref-board").evaluate((board) => {
    const rect = (node) => {
      const { left, right, top, bottom, width, height } = node.getBoundingClientRect();
      return { left, right, top, bottom, width, height };
    };
    return {
      scroll: document.documentElement.scrollWidth, width: innerWidth,
      seats: Array.from(board.querySelectorAll(".ref-seat"), rect),
      host: rect(board.querySelector(".ref-host")),
    };
  });
  assert.equal(geometry.seats.length, expected);
  assert(geometry.scroll <= geometry.width, "The layout overflows horizontally");
  assert(geometry.seats.every((r) => r.width >= 44 && r.height >= 44 && r.left >= 0 && r.right <= geometry.width));
  for (const [i, a] of geometry.seats.entries()) for (const b of [...geometry.seats.slice(i + 1), geometry.host]) {
    assert(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top,
      "Physical seat targets overlap at " + geometry.width + "px");
  }
}
