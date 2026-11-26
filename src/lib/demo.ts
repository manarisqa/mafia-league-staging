// Демонстрационные данные. Заменим настоящими, когда появится база данных.

export const DEMO_EVENING = {
  weekday: "Сб",
  day: "15",
  month: "марта",
  time: "19:00",
  place: "Грац · адрес уточняется",
  format: "Классика",
  capacity: 10,
  signedUp: 6,
  hostConfirmed: true,
  newbiesWelcome: true,
  participants: ["Анна", "Дмитрий", "Елена", "Алексей", "Мария", "Игорь"],
};

export const DEMO_FORMATS = [
  { name: "Классика", players: "10 игроков + ведущий" },
  { name: "Девятка", players: "9 игроков + ведущий" },
];

export const DEMO_RECENT_GAMES = [
  { date: "8 марта", format: "Девятка", status: "Игра завершена" },
  { date: "1 марта", format: "Классика", status: "Игра завершена" },
];

export const DEMO_TOP_PLAYERS = [
  { place: 1, name: "Игрок 01", rating: 1250 },
  { place: 2, name: "Игрок 02", rating: 1180 },
  { place: 3, name: "Игрок 03", rating: 1120 },
];

export const DEMO_LEAGUE_STATS = [
  { value: "40+", label: "Игроков клуба" },
  { value: "25+", label: "Проведено вечеров" },
  { value: "1 150", label: "Средний рейтинг" },
];
