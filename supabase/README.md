# Supabase для Mafia League

## Существующий тестовый проект

Тестовый проект `mafia-league-preview` имеет ref `geinamuvqejjxsnijxol` и уже
содержит данные. Используйте только добавочные миграции спринта:

1. [20261123120000_referee_protocols.sql](migrations/20261123120000_referee_protocols.sql)
   добавляет закрытое хранилище и атомарное утверждение протокола.
2. [20261123121000_public_gaming_names.sql](migrations/20261123121000_public_gaming_names.sql)
   обновляет вывод никнейма в общем публичном снимке, сохраняя идентификаторы.

Перед применением проверьте ref проекта, текущую схему и количество записей.
Предыдущие миграции могли быть выполнены вручную, поэтому запись о них в
панели Supabase может отсутствовать. Пример проверки только на чтение:

```sql
select
  to_regclass('public.referee_protocols') as referee_protocols,
  to_regprocedure('public.league_snapshot()') as snapshot_rpc,
  to_regprocedure('public.save_game(uuid,uuid,jsonb,public.game_winner,boolean,bigint,text,text)') as save_game_rpc,
  (select count(*) from public.players) as players,
  (select count(*) from public.evenings) as evenings,
  (select count(*) from public.games) as games;
```

Применяйте только отсутствующие изменения из этого списка в заданном
порядке. Существующую базу сохраняйте вместе с её данными и историей.
Повторный запуск init, прежних миграций, seed и скрипта сброса для неё
исключён. Для Preview укажите публичные параметры именно этого проекта.
Миграции выполняются отдельно от деплоя Vercel и не откатываются через Git.

## Новая локальная база для QA

Только для пустой одноразовой локальной базы примените `migrations/*.sql` по
имени и один набор синтетических данных `preview-seed.sql`. Он добавляет
20 Classic10, 5 Short9, тестовых игроков и вечера. Начальная схема, seed и
тестовые аккаунты нужны только в изолированном контуре проверки.

Права администратора определяются строкой `public.admins.user_id`. После
входа с существующей учётной записью раздел «Админка» ведёт на `/admin`.
Новая регистрация сама по себе даёт обычный аккаунт игрока. Храните секреты
и реальные учётные данные в настройках соответствующей среды.
