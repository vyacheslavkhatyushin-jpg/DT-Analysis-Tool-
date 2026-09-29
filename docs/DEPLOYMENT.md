# Развёртывание

Система ставится на одну ВМ в сети предприятия и работает **без доступа в интернет**. Всё нужное
(образы Docker, скрипты) приезжает одним архивом.

## Что нужно на ВМ

| | |
|---|---|
| ОС | Linux x86_64 (Ubuntu, Astra Linux, РЕД ОС) |
| ПО | Docker Engine 24+ с плагином `docker compose`, `openssl` |
| Ресурсы | 4–8 vCPU, 16 ГБ RAM, от 200 ГБ SSD |
| Сеть | входящий 443/TCP (и 80/TCP для перенаправления на HTTPS) из сети предприятия; позже — из APN LTE-сети для приложений и зондов |

База данных наружу не публикуется: к ней обращается только приложение внутри Docker.

## Сборка релиза

На машине с интернетом (или в CI), из корня репозитория:

```bash
deploy/scripts/make-release.sh 0.1.0
# → release/dtat-0.1.0.tar.gz и .sha256
```

Архив содержит образы приложения и базы данных (~1,3 ГБ), `docker-compose.yml` и скрипты.
Для обновлений, где образ БД не менялся, можно собрать архив без него: `make-release.sh 0.1.1 --no-db-image`.

## Установка

```bash
sha256sum -c dtat-0.1.0.tar.gz.sha256
sudo mkdir -p /opt/dtat
sudo tar -xzf dtat-0.1.0.tar.gz --strip-components=1 -C /opt/dtat
cd /opt/dtat && sudo ./install.sh
```

При первой установке `install.sh`:

1. загружает образы (`docker load`);
2. создаёт `.env` со случайными паролем БД и ключом подписи сессий;
3. выпускает самоподписанный сертификат, если в `certs/` нет своего;
4. запускает систему; миграции БД применяются автоматически;
5. печатает пароль пользователя `admin`. Смените его после первого входа (меню пользователя → «Сменить пароль»)
   и удалите `DTAT_INITIAL_ADMIN_PASSWORD` из `.env`.

Откройте `https://<имя-ВМ>/`.

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

Тот же порядок, что при установке, **в ту же папку**: `.env`, сертификаты, подложки и бэкапы сохраняются.

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

Ежедневный бэкап через cron:

```
30 2 * * * /opt/dtat/backup.sh >> /opt/dtat/backups/backup.log 2>&1
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
