# Развёртывание

Система ставится на одну ВМ в сети предприятия. Два способа:

- **из GitHub**, если ВМ может выходить на `github.com` и `ghcr.io` (напрямую или через прокси):
  обновление одной командой `./update.sh`. Удобно на этапе опытной эксплуатации;
- **из архива релиза**, если интернета на ВМ нет совсем: образы и скрипты приезжают одним файлом.

Входящих подключений из интернета не нужно ни в одном из способов.

## Что нужно на ВМ

| | |
|---|---|
| ОС | Linux x86_64 (Ubuntu, Astra Linux, РЕД ОС) |
| ПО | Docker Engine 24+ с плагином `docker compose`, `openssl` |
| Ресурсы для опытной эксплуатации (инвентарь, импорт драйв-тестов) | 2–4 vCPU, 8 ГБ RAM, 50 ГБ диска |
| Ресурсы с постоянной телеметрией и ортофото (этапы 3–4) | 4–8 vCPU, 16 ГБ RAM, от 200 ГБ SSD |
| Сеть | входящий 443/TCP (и 80/TCP для перенаправления на HTTPS) из сети предприятия; позже — из APN LTE-сети для приложений и зондов |

База данных наружу не публикуется: к ней обращается только приложение внутри Docker.

Замеры на демо-данных: приложение занимает около 400 МБ памяти (БД ~200 МБ, API ~200 МБ, nginx ~10 МБ);
образы Docker — около 5 ГБ на диске, архив релиза — 1,3 ГБ (после установки его можно удалить).
Параметры памяти PostgreSQL подбираются автоматически под RAM ВМ при первом запуске.
Основной расход диска на следующих этапах: замеры телеметрии (порядка 10–20 ГБ в год на 50 устройств после
сжатия), ортофото (от сотен МБ до единиц ГБ в зависимости от разрешения) и бэкапы. Журналы контейнеров
ограничены 50 МБ на сервис. Попросите ИТ сделать диск расширяемым (LVM), чтобы увеличить его без переустановки.

## Способ 1. Установка из GitHub

CI после успешных тестов на ветке `main` публикует образы в GitHub Container Registry
(`ghcr.io/<владелец>/dtat-api`, `dtat-web` и копию образа БД). ВМ их только скачивает, адреса заданы в
`deploy/online.env`. ВМ нужен исходящий HTTPS к `github.com`, `ghcr.io`, `pkg-containers.githubusercontent.com`.

**Docker** (Ubuntu 22.04):

```bash
sudo apt update && sudo apt install -y docker.io docker-compose-v2 git
sudo systemctl enable --now docker
```

**Прокси.** Если ВМ выходит в интернет через прокси, Docker об этом сам не знает: переменные `http_proxy`
в shell на него не действуют. Создайте `/etc/systemd/system/docker.service.d/http-proxy.conf`:

```ini
[Service]
Environment="HTTP_PROXY=http://<прокси>:<порт>"
Environment="HTTPS_PROXY=http://<прокси>:<порт>"
Environment="NO_PROXY=localhost,127.0.0.1,.local"
```

и перезапустите Docker: `sudo systemctl daemon-reload && sudo systemctl restart docker`.

**Сети Docker.** Docker создаёт внутренние сети из диапазона 172.17–172.31.x.x. Если такие адреса есть в сети
предприятия, укажите свободную подсеть в `/etc/docker/daemon.json` до установки и перезапустите Docker:

```json
{ "bip": "192.168.250.1/28", "default-address-pools": [{ "base": "192.168.250.16/28", "size": 28 }] }
```

**Доступ к образам.** Если репозиторий или его пакеты закрыты, войдите в реестр токеном
(GitHub → Settings → Developer settings → Personal access tokens (classic), единственное право `read:packages`):

```bash
sudo docker login ghcr.io -u <пользователь GitHub>
```

**Установка:**

```bash
sudo git clone -b main https://github.com/<владелец>/DT-Analysis-Tool-.git /opt/dtat
cd /opt/dtat/deploy && sudo ./install.sh
```

**Обновление** (бэкап базы, `git pull`, новые образы, перезапуск; миграции применяются сами):

```bash
cd /opt/dtat/deploy && sudo ./update.sh
```

Какая сборка работает, видно в `https://<имя-ВМ>/api/health`: поле `build` — коммит.

## Способ 2. Архив релиза

### Сборка архива

В GitHub: Actions → Release → Run workflow (версия, например `0.1.0`), архив прикрепляется к запуску.
Или тег `v0.1.0`: архив прикрепляется к релизу. Или на машине с Docker и интернетом, из корня репозитория:

```bash
deploy/scripts/make-release.sh 0.1.0
# → release/dtat-0.1.0.tar.gz и .sha256
```

Архив содержит образы приложения и базы данных (~1,3 ГБ), `docker-compose.yml` и скрипты.
Для обновлений, где образ БД не менялся, можно собрать архив без него: `make-release.sh 0.1.1 --no-db-image`.

### Установка из архива

```bash
sha256sum -c dtat-0.1.0.tar.gz.sha256
sudo mkdir -p /opt/dtat
sudo tar -xzf dtat-0.1.0.tar.gz --strip-components=1 -C /opt/dtat
cd /opt/dtat && sudo ./install.sh
```

## Что делает install.sh при первом запуске

1. загружает образы: из архива (`docker load`) или из реестра (`docker compose pull`);
2. создаёт `.env` со случайными паролем БД и ключом подписи сессий;
3. выпускает самоподписанный сертификат, если в `certs/` нет своего;
4. запускает систему; миграции БД применяются автоматически;
5. печатает пароль пользователя `admin`. Смените его после первого входа (меню пользователя → «Сменить пароль»)
   и удалите `DTAT_INITIAL_ADMIN_PASSWORD` из `.env`.

Откройте `https://<имя-ВМ>/`. Остальные команды в этом документе выполняются в папке установки:
`/opt/dtat/deploy` для установки из GitHub, `/opt/dtat` для установки из архива.

Демо-данные (синтетический карьер) можно загрузить только в пустую базу, для знакомства с системой:
`docker compose exec api dtat seed-demo`.

## Сертификат

Самоподписанный сертификат браузеры показывают как недоверенный. Замените его сертификатом,
выпущенным ИБ (с цепочкой промежуточных сертификатов в `server.crt`):

```bash
cp server.crt server.key /opt/dtat/certs/
docker compose restart web
```

## Подложки карты

Любой файл `*.pmtiles`, положенный в `/opt/dtat/data/tiles/`, появляется в списке «Подложка» на карте:
перезапуск не нужен. Поддерживаются растровые (ортофото) и векторные (OpenStreetMap в схеме Protomaps) архивы.

**Ортофотоплан маркшейдерии** (GeoTIFF) → PMTiles, с помощью [GDAL](https://gdal.org) и
[pmtiles CLI](https://github.com/protomaps/go-pmtiles):

```bash
gdalwarp -t_srs EPSG:3857 -r bilinear ortho.tif ortho_3857.tif
# местная система координат без EPSG-кода: добавьте -s_srs "<proj-строка от маркшейдерии>"
gdal_translate -of MBTILES ortho_3857.tif ortho.mbtiles
gdaladdo -r average ortho.mbtiles 2 4 8 16 32
pmtiles convert ortho.mbtiles ortho-2026-09.pmtiles
```

**Карта OpenStreetMap региона** (на машине с интернетом, затем перенести файл на ВМ):

```bash
pmtiles extract https://build.protomaps.com/<дата>.pmtiles region.pmtiles --bbox=<запад>,<юг>,<восток>,<север> --maxzoom=15
```

Актуальные даты сборок и подробности: <https://docs.protomaps.com/basemaps/downloads>.

## Слои: контур карьера, уступы, отвалы

Слои загружаются в интерфейсе: «Импорт и экспорт» → «Слои карты», формат GeoJSON в WGS-84.
Из DXF маркшейдерии GeoJSON получается так:

```bash
ogr2ogr -f GeoJSON -s_srs "<proj-строка местной СК>" -t_srs EPSG:4326 pit.geojson pit.dxf
```

## Обновление

Установка из GitHub: `sudo ./update.sh` (см. выше).

Установка из архива: тот же порядок, что при установке, **в ту же папку**: `.env`, сертификаты, подложки
и бэкапы сохраняются.

```bash
cd /opt/dtat && sudo ./backup.sh
sudo tar -xzf dtat-0.2.0.tar.gz --strip-components=1 -C /opt/dtat
sudo ./install.sh
```

## Резервное копирование

```bash
./backup.sh            # дамп в backups/, хранятся последние 14 (KEEP=30 ./backup.sh — больше)
./restore.sh backups/dtat-20260929-023000.dump
```

Ежедневный бэкап через cron (путь для установки из GitHub; для архива — `/opt/dtat/backup.sh`):

```
30 2 * * * /opt/dtat/deploy/backup.sh >> /opt/dtat/deploy/backups/backup.log 2>&1
```

Копируйте `backups/` за пределы ВМ. Кроме базы, сохраните `.env`, `certs/` и `data/tiles/`.

## Диагностика

```bash
docker compose ps                  # состояние сервисов
docker compose logs -f api         # журнал приложения
docker compose logs migrate        # как прошли миграции
curl -k https://localhost/api/health
```

## Безопасность

- HTTPS; сессия — httpOnly-cookie с флагом Secure; попытки входа ограничены по частоте (nginx).
- Роли: администратор (пользователи), инженер (правка инвентаря), просмотр.
- Секреты — в `.env` с правами 600; база данных недоступна снаружи Docker.
- Журнал изменений фиксирует, кто, когда и что поменял в инвентаре.
