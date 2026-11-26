import type { Metadata } from "next";
import { ButtonLink, Card, PageHero } from "@/components/ui";
import { TableDiagram } from "@/components/table-diagram";
import { NewbiePath } from "@/app/learn/newbie-path";
import { getLocale } from "@/lib/i18n/server";
import { siteText } from "@/lib/i18n/site";

export async function generateMetadata(): Promise<Metadata> {
  return { title: siteText(await getLocale(), "Обучение") };
}

const MATERIALS = [
  { title: "Основы", text: "Правила, роли, формат, частые вопросы." },
  { title: "Практика", text: "Разбор ситуаций и типичных ошибок." },
  { title: "Для опытных", text: "Углублённые материалы и тактические темы." },
];

export default async function LearnPage() {
  const locale = await getLocale();
  const t = (text: string) => siteText(locale, text);
  return (
    <>
      <PageHero
        title={t("Научись играть в Мафию")}
        subtitle={t("Никогда не играл? Начни с основ — мы поможем.")}
      />

      <div className="mx-auto max-w-7xl space-y-10 px-4 py-10 sm:px-6">
        <Card className="border-accent/50 bg-accent/5">
          <h2 className="font-display text-3xl font-bold">{t("Новичкам")}</h2>
          <p className="mt-1 text-muted">{t("Правила, роли и первые шаги")}</p>
          <p className="mt-4 max-w-2xl text-muted">{t("Короткий и понятный курс, который поможет разобраться в спортивной Мафии и уверенно прийти на свой первый игровой вечер.")}</p>
          <p className="mt-5 text-sm text-accent-text">{t("Начните с «Пути новичка» ниже.")}</p>
        </Card>

        <section aria-labelledby="path">
          <h2 id="path" className="font-display text-2xl font-bold">{t("Путь новичка")}</h2>
          <p className="mt-1 text-muted">{t("Четыре коротких урока — и вы готовы к первой игре. Нажмите на шаг, чтобы открыть его.")}</p>
          <NewbiePath />
        </section>

        <Card>
          <div className="grid items-center gap-8 md:grid-cols-2">
            <div>
              <h2 className="font-display text-2xl font-bold">{t("Как устроен игровой стол")}</h2>
              <p className="mt-3 text-muted">{t("Классика — 10 игроков и ведущий. Девятка — 9 игроков и ведущий.")}</p>
            </div>
            <div className="flex justify-center">
              <TableDiagram seats={10} />
            </div>
          </div>
        </Card>

        <section aria-labelledby="choose">
          <h2 id="choose" className="font-display text-2xl font-bold">{t("Выбери, что изучать")}</h2>
          <p className="mt-1 text-muted">{t("Материалы подходят для любого уровня. Доступны без регистрации.")}</p>
          <ul className="mt-5 grid gap-4 md:grid-cols-3">
            {MATERIALS.map((m) => (
              <li key={m.title} className="rounded-card border border-border bg-surface p-5">
                <h3 className="font-display text-lg font-bold">{t(m.title)}</h3>
                <p className="mt-2 text-sm text-muted">{t(m.text)}</p>
              </li>
            ))}
          </ul>
        </section>

        <div className="flex flex-col gap-4 rounded-card border border-border bg-surface p-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-display text-2xl font-bold">{t("Приходи на игровой вечер в Граце")}</h2>
            <p className="mt-2 max-w-xl text-muted">{t("Лучший способ научиться — сыграть вживую. Мы всегда рады новым игрокам, даже если вы ещё не изучили весь курс.")}</p>
          </div>
          <ButtonLink href="/evenings">{t("Ближайшая встреча")}</ButtonLink>
        </div>
      </div>
    </>
  );
}
