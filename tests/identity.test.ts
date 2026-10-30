import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeNickname, isValidNickname } from "../src/lib/nickname";
import { LOCALES, messages, parseLocale, translate } from "../src/lib/i18n/messages";

test("gaming nicknames accept Cyrillic and normalize Unicode without requiring a legal name", () => {
  for (const name of ["Сова", "Мандрівник", "Гравець 7", "Night Fox", "Ёж", "7", "Сова 🦉"]) assert(isValidNickname(name));
  assert.equal(normalizeNickname("  И\u0306ож  "), "Йож");
  assert(isValidNickname("Я".repeat(40)));
  for (const name of ["", "   ", "🦉", "A".repeat(41), "Сова\u200b", "Сова\nFox", "<Игрок>", "\u202eFox"]) assert(!isValidNickname(name), JSON.stringify(name));
});

test("RU/UK dictionaries cover the same keys and unsupported cookie values fall back safely", () => {
  assert.equal(parseLocale("uk"), "uk");
  for (const value of [undefined, null, "en", "ru", "UK", "../../admin"]) assert.equal(parseLocale(value), "ru");
  assert.deepEqual(Object.keys(messages.ru).sort(), Object.keys(messages.uk).sort());
  for (const locale of LOCALES) for (const value of Object.values(messages[locale])) assert(value.trim());
  assert.equal(translate("uk", "nickname"), "Ігровий нікнейм");
});
