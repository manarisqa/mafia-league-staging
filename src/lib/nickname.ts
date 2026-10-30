/** Public gaming identity; never require a legal name or derive it from email. */
export function normalizeNickname(value: string): string {
  return value.normalize("NFC").trim();
}

export function isValidNickname(value: string): boolean {
  const nickname = normalizeNickname(value);
  return [...nickname].length >= 1 && [...nickname].length <= 40 &&
    /[\p{L}\p{N}]/u.test(nickname) && !/[\p{C}<>]/u.test(nickname);
}
