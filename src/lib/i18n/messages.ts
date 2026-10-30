export const LOCALES = ["ru", "uk"] as const;
export type Locale = (typeof LOCALES)[number];
export const LOCALE_COOKIE = "mafia-locale";
export function parseLocale(value: unknown): Locale { return value === "uk" ? "uk" : "ru"; }

const ru = {
  home: "Главная", evenings: "Вечера", players: "Игроки", rating: "Рейтинг", history: "История", learn: "Обучение",
  navigation: "Основная навигация", mobileNavigation: "Мобильная навигация", footerNavigation: "Навигация в подвале",
  openMenu: "Открыть меню", closeMenu: "Закрыть меню", language: "Язык сайта",
  footer: "Сообщество любителей спортивной Мафии в Граце. Новичкам всегда рады.", location: "Грац, Австрия",
  register: "Регистрация", signUp: "Зарегистрироваться", registering: "Регистрируем…",
  login: "Вход", signIn: "Войти", signingIn: "Входим…", signOut: "Выйти", profile: "Профиль", admin: "Админка",
  registerIntro: "Чтобы записываться на игровые вечера. Играть можно и без регистрации.",
  loginIntro: "Для игроков и организаторов клуба.", haveAccount: "Уже есть аккаунт?", noAccount: "Нет аккаунта?",
  nickname: "Игровой никнейм", nicknameHelp: "Так вас будут видеть в клубе, рейтинге и истории. Реальное имя не требуется. Кириллица разрешена.",
  email: "Почта", password: "Пароль", newPassword: "Пароль (не короче 8 символов)",
  nicknameInvalid: "Никнейм: от 1 до 40 символов, хотя бы одна буква или цифра, без скрытых символов и < >.",
  emailInvalid: "Проверьте адрес почты.", passwordShort: "Пароль: не короче 8 символов.", passwordLong: "Пароль: не длиннее 72 символов.",
  credentialsRequired: "Введите почту и пароль.", credentialsInvalid: "Неверная почта или пароль.", forbidden: "У этой учётной записи нет прав администратора.",
  emailRegistered: "Эта почта уже зарегистрирована. Попробуйте войти.", passwordWeak: "Пароль слишком простой. Придумайте посложнее.",
  registrationFailed: "Не удалось зарегистрироваться. Попробуйте ещё раз.", confirmEmail: "Мы отправили письмо для подтверждения почты. Перейдите по ссылке в нём и войдите.",
} as const;

export type MessageKey = keyof typeof ru;
const uk: Record<MessageKey, string> = {
  home: "Головна", evenings: "Вечори", players: "Гравці", rating: "Рейтинг", history: "Історія", learn: "Навчання",
  navigation: "Основна навігація", mobileNavigation: "Мобільна навігація", footerNavigation: "Навігація внизу сторінки",
  openMenu: "Відкрити меню", closeMenu: "Закрити меню", language: "Мова сайту",
  footer: "Спільнота шанувальників спортивної Мафії у Граці. Новачкам завжди раді.", location: "Грац, Австрія",
  register: "Реєстрація", signUp: "Зареєструватися", registering: "Реєструємо…",
  login: "Вхід", signIn: "Увійти", signingIn: "Входимо…", signOut: "Вийти", profile: "Профіль", admin: "Адмінка",
  registerIntro: "Щоб записуватися на ігрові вечори. Грати можна й без реєстрації.",
  loginIntro: "Для гравців та організаторів клубу.", haveAccount: "Уже є акаунт?", noAccount: "Немає акаунту?",
  nickname: "Ігровий нікнейм", nicknameHelp: "Так вас бачитимуть у клубі, рейтингу та історії. Справжнє ім’я не потрібне. Кирилиця дозволена.",
  email: "Пошта", password: "Пароль", newPassword: "Пароль (щонайменше 8 символів)",
  nicknameInvalid: "Нікнейм: від 1 до 40 символів, хоча б одна літера або цифра, без прихованих символів і < >.",
  emailInvalid: "Перевірте адресу пошти.", passwordShort: "Пароль: щонайменше 8 символів.", passwordLong: "Пароль: не більше 72 символів.",
  credentialsRequired: "Введіть пошту та пароль.", credentialsInvalid: "Неправильна пошта або пароль.", forbidden: "Цей обліковий запис не має прав адміністратора.",
  emailRegistered: "Цю пошту вже зареєстровано. Спробуйте увійти.", passwordWeak: "Пароль надто простий. Придумайте складніший.",
  registrationFailed: "Не вдалося зареєструватися. Спробуйте ще раз.", confirmEmail: "Ми надіслали лист для підтвердження пошти. Перейдіть за посиланням у ньому та увійдіть.",
};
export const messages: Record<Locale, Record<MessageKey, string>> = { ru, uk };
export function translate(locale: Locale, key: MessageKey): string { return messages[locale][key]; }
