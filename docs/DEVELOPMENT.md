# Разработка

## Что нужно

- Docker (база данных для разработки и тестов);
- Python 3.12 и [uv](https://docs.astral.sh/uv/);
- Node.js 22.

## Запуск

```bash
# 1. База данных (PostgreSQL 16 + PostGIS + TimescaleDB)
docker compose -f deploy/docker-compose.dev.yml up -d

# 2. Backend: http://localhost:8000/api/docs
cd backend
cp .env.example .env
uv sync
uv run dtat migrate
uv run dtat create-user admin            # спросит пароль
uv run dtat seed-demo                    # синтетический карьер: 22 сайта, 65 сот, техника
uv run uvicorn dtat.main:app --reload

# 3. Frontend: http://localhost:5173 (проксирует /api и /tiles на :8000)
cd frontend
npm ci
npm run dev
```

Офлайн-подложки для разработки: положите `.pmtiles` в папку `tiles/` в корне репозитория.

## Проверки

Те же, что в CI (`.github/workflows/ci.yml`).

```bash
cd backend
uv run ruff format . && uv run ruff check .
uv run mypy src tests
uv run pytest                 # поднимает временную БД через testcontainers
# или на своей базе: TEST_DATABASE_URL=postgresql+psycopg://dtat:dtat@localhost:5432/dtat_test uv run pytest

cd frontend
npm run lint && npm run format:check && npm run typecheck && npm test && npm run build
```

Тесты бэкенда работают с настоящей PostgreSQL + PostGIS, а не с моками: каждый тест выполняется в транзакции,
которая откатывается.

## Структура

```
backend/src/dtat/
  auth/        пользователи, роли, вход (JWT в httpOnly-cookie или Bearer)
  inventory/   сайты, eNodeB, соты, техника, устройства, слои карты; Excel; LTE-арифметика
  audit/       журнал изменений
  maps/        подложки (PMTiles), данные для карты
  synthetic/   генератор демо-карьера
  migrations/  Alembic
frontend/src/
  api/         типизированный клиент (типы генерируются из OpenAPI бэкенда)
  map/         MapLibre: стиль, секторы, панели
  pages/, forms/, components/
deploy/        docker compose, скрипты релиза, установки, бэкапа
```

## Договорённости

- **Сервисы не коммитят.** Транзакцией управляет вызывающий (роутер, импорт, CLI). Поэтому импорт Excel
  атомарен, а «проверка без применения» — это откат той же транзакции.
- **Каждое изменение инвентаря пишется в журнал** (`audit.service.record_change`) с разницей по полям.
- **История конфигурации.** Радиопараметры соты версионируются (`cell_version`), положение сайта тоже
  (`site_position`). Периоды — `tstzrange`, пересечения запрещены exclusion-ограничениями в БД.
  Первая версия действует «с начала времён», чтобы к ней привязывались и старые замеры.
- **Тексты интерфейса и сообщения об ошибках — на русском, код и комментарии — на английском.**
- Решения, влияющие на архитектуру, фиксируются в [`docs/adr/`](adr/).

## Изменение схемы БД

```bash
cd backend
# поменяли модели в src/dtat/**/models.py
uv run alembic revision --autogenerate -m "что изменилось"
# проверьте сгенерированный файл в src/dtat/migrations/versions/, затем:
uv run dtat migrate
```

## Изменение API

После изменения схем или эндпоинтов бэкенда обновите типы фронтенда и закоммитьте их:

```bash
cd frontend && npm run gen:api
```

CI проверяет, что закоммиченные типы совпадают с бэкендом.
