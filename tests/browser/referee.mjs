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

async function start(page, short = false, capture = true) {
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
  await admin.getByRole("link", { name: /Классика · Партия/ }).first().click();
  await admin.getByRole("heading", { name: "Проверьте протокол" }).waitFor();
  await shot(admin, "08-admin-review-desktop");
  await admin.getByLabel("Я проверил наблюдения и причины исправлений").check();
  await click(admin, "Утвердить и опубликовать");
  await admin.getByRole("link", { name: "Открыть игру" }).waitFor();
  const classicGame = await admin.getByRole("link", { name: "Открыть игру" }).getAttribute("href");
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
