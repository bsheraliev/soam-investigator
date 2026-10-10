# SOAM Investigator — сервер (этап 4)

Назначение: общее хранилище дел для организации — пользователи и роли, передача дел между расследователями, журнал действий. Приложение остаётся офлайн-первым: сервер подключается по желанию, без него всё работает как раньше.

## Модель
- **Организация** → **пользователи** (роли: `admin` — управляет пользователями и удаляет дела; `investigator` — читает и пишет дела; `reader` — только читает) → **дела**.
- Дело хранится целиком как пакет JSON того же формата, что «Экспорт в JSON» в приложении (вложения внутри, base64). Проверка пакета — той же функцией `js/bundle.js`, что и в приложении.
- Запись с **оптимистической блокировкой**: клиент присылает `baseVersion`; если на сервере версия другая — ответ `409 version-conflict` с актуальной версией.
- **Журнал действий** (`audit`): регистрация, вход, создание/изменение/удаление дела, изменения пользователей.
- Пароли — scrypt; сессия — случайный токен (в БД только его SHA-256), срок `SESSION_DAYS` (30).

## API (JSON, `Authorization: Bearer <token>`)
| Метод | Путь | Кто | Что |
|---|---|---|---|
| GET | `/api/health` | все | состояние, тип БД, открыта ли регистрация |
| POST | `/api/auth/register` | все (если `ALLOW_REGISTRATION`) | организация + первый администратор → token |
| POST | `/api/auth/login` | все | email + password → token |
| POST | `/api/auth/logout` | вход | закрыть сессию |
| POST | `/api/auth/password` | вход | `{ current, next }` |
| GET | `/api/me` | вход | пользователь и организация |
| GET / POST | `/api/users` | admin | список / создать (`name, email, password, role`) |
| PATCH | `/api/users/:id` | admin | `role`, `disabled`, `password` |
| GET | `/api/cases` | вход | список дел организации (без пакетов) |
| GET | `/api/cases/:id` | вход | дело с пакетом |
| PUT | `/api/cases/:id` | admin, investigator | `{ bundle, baseVersion }` → `201` создано / `200` обновлено / `409` конфликт |
| DELETE | `/api/cases/:id` | admin | удалить |
| GET | `/api/audit?caseId=&limit=` | admin, investigator | журнал |
| GET | `/api/stats/actions` | вход | реестр мер по всем делам организации (просрочка, порядок) |
| GET | `/api/stats/osf` | вход | статистика по 12 кодам OSF по всем делам |
| GET | `/api/export` | admin | резервная копия: все дела организации пакетами (JSON) |

Ошибки: `{ "error": "<код>" }` — `unauthorized`, `forbidden`, `disabled`, `not-found`, `email-taken`, `bad-credentials`, `too-many-attempts` (+ `retryAfterSec`), `version-conflict` (+ `version`), `bundle` (+ `errors`), `registration-closed`, `too-large`.

Защита: 10 неудачных входов на пару IP + почта → блок 15 минут (`LOGIN_MAX_ATTEMPTS`); регистрация — 20 в час на IP (`REGISTER_MAX_PER_HOUR`); пароль 8–200 символов; заголовки `X-Content-Type-Options: nosniff`, `Cache-Control: no-store`; `trust proxy` для реального IP за Render.

## Локально
```powershell
cd C:\Users\user\Claude\Projects\soam-investigator\server
npm install
npm test        # node:test, SQLite в памяти
npm start       # http://localhost:8160/api/health, БД server\data\soam.sqlite
```

## Развёртывание (Render + Neon, бесплатные тарифы) — делает владелец
1. **Neon** (https://console.neon.tech): создать проект `soam-investigator`, скопировать строку подключения (Connection string, с `sslmode=require`).
2. **Render** (https://dashboard.render.com): New → Blueprint → репозиторий `bsheraliev/soam-investigator`, ветка `main`. Render прочитает `render.yaml` и создаст сервис `soam-investigator-api`.
3. В сервисе → Environment: вставить `DATABASE_URL` из Neon. Остальные переменные уже в `render.yaml` (`ALLOWED_ORIGINS` = адрес GitHub Pages).
4. После деплоя открыть `https://<имя-сервиса>.onrender.com/api/health` — должно быть `{"ok":true,"db":"pg","schema":1,...}`.
5. Зарегистрировать организацию и первого администратора (один раз), затем закрыть регистрацию: Environment → `ALLOW_REGISTRATION=false` → Save (сервис перезапустится):
```powershell
Invoke-RestMethod -Method Post -Uri "https://<имя-сервиса>.onrender.com/api/auth/register" -ContentType "application/json" -Body '{"organisation":"АГА РТ","name":"Имя","email":"admin@example.tj","password":"<пароль ≥ 8>"}'
```
Пароль вводит владелец сам; в репозиторий, заметки и чат он не попадает.

## Переменные окружения
`PORT` (Render задаёт сам; локально 8160) · `DATABASE_URL` (Postgres; без неё — SQLite) · `SQLITE_PATH` · `ALLOWED_ORIGINS` (через запятую; `*` — любые) · `ALLOW_REGISTRATION` (`true`/`false`) · `SESSION_DAYS` · `BODY_LIMIT` (по умолчанию `30mb`).

## Ограничения бесплатного тарифа
Render free засыпает после 15 минут простоя — первый запрос после паузы занимает до минуты. Neon free — 0,5 ГБ; дело с вложениями до нескольких МБ, этого хватает на сотни дел.

## Конфиденциальность
Материалы расследований хранятся только в вашей базе Neon; сервер не обращается к сторонним сервисам. Для ДСП-материалов — отдельная база и закрытая регистрация.
