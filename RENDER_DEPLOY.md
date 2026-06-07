# Aurora Messenger — Полный гайд по деплою на Render

## Содержание
1. [Подготовка репозитория](#1-подготовка-репозитория)
2. [Создание MySQL на Render](#2-создание-mysql-на-render)
3. [Деплой Web Service через Blueprint](#3-деплой-web-service-через-blueprint)
4. [Настройка переменных окружения](#4-настройка-переменных-окружения)
5. [Перенос базы данных с Railway](#5-перенос-базы-данных-с-railway)
6. [Проверка работоспособности](#6-проверка-работоспособности)
7. [Настройка домена (опционально)](#7-настройка-домена-опционально)
8. [Нативные сборки (Android / Electron)](#8-нативные-сборки-android--electron)
9. [Обновление после деплоя](#9-обновление-после-деплоя)
10. [Частые проблемы и решения](#10-частые-проблемы-и-решения)

---

## 1. Подготовка репозитория

Перед деплоем убедитесь, что все изменения запушены в GitHub:

```bash
# Проверить статус
git status

# Если есть незакоммиченные изменения
git add -A
git commit -m "Prepare for Render deploy"
git push origin main
```

**Что уже сделано:**
- ✅ Большие файлы (`Aurora-Linux.AppImage`, `Aurora-Windows.exe`, `bore`, `cloudflared`) удалены из истории git
- ✅ Они добавлены в `.gitignore`
- ✅ `render.yaml` исправлен (удалён неподдерживаемый `type: mysql`)
- ✅ Есть `Dockerfile.render` — собирает React фронтенд + Python бэкенд

---

## 2. Создание MySQL на Render

Render **не умеет** создавать MySQL автоматически через Blueprint, поэтому БД нужно создать вручную.

### 2.1. Заходим в Render Dashboard

Откройте [https://dashboard.render.com](https://dashboard.render.com) и войдите через GitHub.

### 2.2. Создаём MySQL

Нажмите **New +** → **MySQL**

Заполните поля:

| Поле | Значение |
|------|----------|
| **Name** | `aurora-db` |
| **Plan** | `Free` (512 MB, 1 GB disk) |
| **Region** | `Frankfurt (EU)` |
| **Database** | `messenger` |
| **User** | `aurora` |

> ⚠️ **Важно**: Регион должен совпадать с регионом Web Service (оба Frankfurt).

Нажмите **Create Database**.

### 2.3. Копируем Internal Connection String

После создания БД откроется страница с информацией:

1. Найдите поле **"Internal Connection String"**
2. Нажмите **Copy** (иконка копирования справа)
3. Сохраните строку — она понадобится на шаге 4

Строка выглядит так:
```
mysql://aurora:пароль@render-host:3306/messenger
```

---

## 3. Деплой Web Service через Blueprint

### 3.1. Создаём Blueprint

1. Нажмите **New +** → **Blueprint**
2. Выберите **Connect from GitHub**
3. Найдите репозиторий `kayanoooo/aurora`
4. Разрешите доступ к репозиторию

### 3.2. Настройка Blueprint

Render прочитает `render.yaml` и покажет превью:

- **Name**: `aurora`
- **Type**: Web Service
- **Dockerfile Path**: `./Dockerfile.render`
- **Region**: `Frankfurt`

### 3.3. Запуск деплоя

Нажмите **Apply**. Render начнёт:

1. Клонировать репозиторий
2. Собирать Docker образ:
   - Установка Node.js зависимостей
   - Билд React клиента (`npm run build`)
   - Установка Python зависимостей (`pip install`)
3. Запускать сервер (`uvicorn app.main:app ...`)

> ⏱ **Время**: Первый деплой может занять **5–10 минут**.

> ⚠️ **Важно**: На этом этапе сервис **упадёт с ошибкой**, потому что MySQL ещё не подключена. Это нормально — исправим на следующем шаге.

---

## 4. Настройка переменных окружения

После создания Web Service перейдите в **Dashboard → aurora → Environment**.

Добавьте следующие переменные:

### 4.1. MySQL (обязательно)

| Key | Value | Откуда взять |
|-----|-------|-------------|
| `MYSQL_URL` | Вставьте Internal Connection String | Скопировали на шаге 2.3 |

### 4.2. JWT Secret (обязательно)

Сгенерируйте секрет в терминале:
```bash
openssl rand -hex 32
# Пример результата: a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6

# ИЛИ если openssl нет — используйте Python:
python3 -c "import secrets; print(secrets.token_hex(32))"
```

Добавьте переменную:

| Key | Value |
|-----|-------|
| `JWT_SECRET` | Вставьте сгенерированное значение |

### 4.3. CORS (обязательно)

| Key | Value |
|-----|-------|
| `CORS_ORIGINS` | `https://aurora.onrender.com` |

(После настройки своего домена — замените на свой адрес)

### 4.4. Cloudinary (опционально, для загрузки файлов)

Зарегистрируйтесь на [https://cloudinary.com](https://cloudinary.com) (бесплатно до 25GB).

В панели Cloudinary найдите **Cloud name**, **API Key**, **API Secret**:

| Key | Value |
|-----|-------|
| `CLOUDINARY_CLOUD_NAME` | Ваш cloud name |
| `CLOUDINARY_API_KEY` | Ваш API key |
| `CLOUDINARY_API_SECRET` | Ваш API secret |

### 4.5. SMTP (опционально, для отправки email)

Для Gmail:

1. Включите двухфакторную аутентификацию в Google
2. Создайте **пароль приложения**: https://myaccount.google.com/apppasswords
3. Добавьте:

| Key | Value |
|-----|-------|
| `SMTP_HOST` | `smtp.gmail.com` |
| `SMTP_PORT` | `465` |
| `SMTP_USER` | `ваш@gmail.com` |
| `SMTP_PASS` | Пароль приложения Google (16 символов) |
| `SMTP_FROM` | `ваш@gmail.com` |
| `SMTP_FROM_NAME` | `Aurora Messenger` |

### 4.6. Сохраняем

Нажмите **Save Changes**. Render автоматически перезапустит сервис.

---

## 5. Перенос базы данных с Railway

### 5.1. Получаем доступ к Railway MySQL

Ваш старый проект на Railway → MySQL → **Connect** → скопируйте команду подключения.

Railway обычно даёт такие переменные:
```bash
MYSQLHOST=containers-us-west-x.railway.app
MYSQLUSER=root
MYSQLPASSWORD=ваш_пароль
MYSQLDATABASE=railway
MYSQLPORT=3306
```

### 5.2. Устанавливаем MySQL клиент (если нет)

```bash
# Fedora / RHEL
sudo dnf install mysql

# Ubuntu / Debian
sudo apt install mysql-client

# macOS
brew install mysql-client

# Windows — скачайте MySQL Workbench или
# используйте Git Bash с установленным mysql CLI
```

### 5.3. Экспортируем дамп из Railway

```bash
# Замените значения на свои
MYSQLHOST="containers-us-west-x.railway.app"
MYSQLUSER="root"
MYSQLPASSWORD="ваш_пароль"
MYSQLDATABASE="railway"

mysqldump \
  -h "$MYSQLHOST" \
  -u "$MYSQLUSER" \
  -p"$MYSQLPASSWORD" \
  --port 3306 \
  --single-transaction \
  --routines \
  --triggers \
  "$MYSQLDATABASE" > aurora_dump.sql
```

> ⏱ **Время**: Зависит от размера БД. Обычно 1–5 секунд.

Проверьте, что дамп создан:
```bash
ls -lh aurora_dump.sql
# Пример: -rw-r--r-- 1 user user 2.3M Jul  7 19:00 aurora_dump.sql

# Посмотреть первые строки:
head -20 aurora_dump.sql
```

### 5.4. Получаем доступ к Render MySQL

В Render Dashboard → **MySQL** → **aurora-db** → раздел **Connections**.

Там будет:
- **Internal Connection String** (используем её)
- **External Connection String** (если подключаетесь не с Render)

**Вариант A: Подключение через локальный терминал (External)**

Для подключения с вашего компьютера нужно разрешить внешний доступ:

На странице MySQL → **IP Access List** → **Add IP** → введите ваш внешний IP.

Узнать ваш IP:
```bash
curl ifconfig.me
```

Render выдаст **External Connection String**:
```
mysql://aurora:пароль@host:port/messenger
```

### 5.5. Импортируем дамп в Render MySQL

Если используете **External Connection String**:
```bash
# Извлеките host, пароль и порт из External Connection String
# Пример: mysql://aurora:abc123@dpg-xyz.frankfurt.render.com:3306/messenger

RENDER_HOST="dpg-xyz.frankfurt.render.com"
RENDER_USER="aurora"
RENDER_PASS="abc123"
RENDER_DB="messenger"
RENDER_PORT=3306

mysql \
  -h "$RENDER_HOST" \
  -u "$RENDER_USER" \
  -p"$RENDER_PASS" \
  -P "$RENDER_PORT" \
  "$RENDER_DB" < aurora_dump.sql
```

> ⏱ **Время**: Обычно 1–3 секунды для небольшой БД.

Проверьте, что импорт прошёл успешно:
```bash
mysql \
  -h "$RENDER_HOST" \
  -u "$RENDER_USER" \
  -p"$RENDER_PASS" \
  -P "$RENDER_PORT" \
  "$RENDER_DB" \
  -e "SHOW TABLES; SELECT COUNT(*) FROM users;"
```

### 5.6. Разрешаем миграции

При запуске сервер автоматически выполняет миграции в `startup()` — все `ALTER TABLE` и `CREATE TABLE` запросы.

Если что-то пошло не так, можно выполнить вручную:
```bash
# Подключитесь к Render MySQL и запустите файл
mysql \
  -h "$RENDER_HOST" \
  -u "$RENDER_USER" \
  -p"$RENDER_PASS" \
  -P "$RENDER_PORT" \
  "$RENDER_DB" < railway_schema_only.sql
```

---

## 6. Проверка работоспособности

### 6.1. Проверить статус деплоя

Render Dashboard → **aurora** → **Events**. Должно быть:
```
Deploy successful
Your service is live 🚀
```

### 6.2. Проверить health check

Откройте в браузере:
```
https://aurora.onrender.com/api/health
```

Должен быть JSON ответ:
```json
{"message":"Messenger API is running","status":"ok","version":"2.0.0"}
```

### 6.3. Проверить сайт

Откройте:
```
https://aurora.onrender.com
```

Должна загрузиться страница входа Aurora Messenger.

### 6.4. Проверить логи

Render Dashboard → **aurora** → **Logs**. Должны быть строки:
```
✅ Database pool initialized
✅ Migration warning: ... (если колонки уже есть — это нормально)
```

### 6.5. Проверить работу API

Попробуйте зарегистрироваться или войти через веб-интерфейс.

---

## 7. Настройка домена (опционально)

### 7.1. Добавить свой домен

Render Dashboard → **aurora** → **Settings** → **Custom Domain**:

1. Введите ваш домен: `messenger.ваш-домен.ru`
2. Render покажет DNS запись для добавления

### 7.2. Настроить DNS

У вашего регистратора доменов добавьте CNAME запись:

| Тип | Имя | Значение |
|-----|-----|----------|
| CNAME | `messenger` | `aurora.onrender.com` |

### 7.3. Обновить CORS

Render Dashboard → **aurora** → **Environment** → Изменить `CORS_ORIGINS`:
```
https://messenger.ваш-домен.ru
```

Нажмите **Save Changes** → сервис перезапустится.

---

## 8. Нативные сборки (Android / Electron)

Render не поддерживает сборку Android APK или Electron бинарников (нужен GUI). Собирайте локально:

### 8.1. Файл `client/.env.production`

Создайте файл `client/.env.production`:
```env
REACT_APP_API_URL=https://aurora.onrender.com/api
REACT_APP_WS_URL=wss://aurora.onrender.com
```

### 8.2. Сборка Android

```bash
cd client

# Установить зависимости
npm install

# Собрать React с production переменными
REACT_APP_API_URL=https://aurora.onrender.com/api \
REACT_APP_WS_URL=wss://aurora.onrender.com \
npm run build

# Синхронизировать с Capacitor
npx cap sync android

# Собрать APK (требуется Android SDK)
cd android
./gradlew assembleDebug

# Готовый APK: android/app/build/outputs/apk/debug/app-debug.apk
```

### 8.3. Сборка Electron

```bash
cd client

npm install

# Собрать React
REACT_APP_API_URL=https://aurora.onrender.com/api \
REACT_APP_WS_URL=wss://aurora.onrender.com \
npm run build

# Собрать бинарник
npx electron-builder --linux   # Linux AppImage
npx electron-builder --win     # Windows .exe
npx electron-builder --mac     # macOS .dmg
```

---

## 9. Обновление после деплоя

### Автоматическое обновление

1. Внесите изменения в код локально
2. Закоммитьте и запушьте:
```bash
git add -A
git commit -m "Описание изменений"
git push origin main
```

3. Render автоматически:
   - Обнаружит новый коммит
   - Пересоберёт Docker образ
   - Перезапустит сервис
   - Деплой займёт ~3–5 минут

### Ручное обновление

Render Dashboard → **aurora** → **Manual Deploy** → **Deploy latest commit**

---

## 10. Частые проблемы и решения

### ❌ Ошибка: `Can't connect to MySQL server`

**Причина**: Неверная строка подключения или MySQL не создана.

**Решение**:
1. Проверьте, что MySQL создана (Render Dashboard → MySQL)
2. Проверьте `MYSQL_URL` в Environment Variables
3. Убедитесь, что регионы совпадают (оба Frankfurt)

### ❌ Ошибка: `Access denied for user`

**Причина**: Неверный пароль в Connection String.

**Решение**:
1. Зайдите в Render → MySQL → **Reset Password**
2. Скопируйте новую Internal Connection String
3. Обновите `MYSQL_URL` в Web Service

### ❌ Ошибка: `Unknown database 'messenger'`

**Причина**: База данных не создалась автоматически.

**Решение**:
Подключитесь к MySQL и создайте БД:
```bash
mysql -h host -u aurora -p -e "CREATE DATABASE IF NOT EXISTS messenger;"
```

Или укажите существующую БД в `MYSQL_URL`:
```
mysql://aurora:пароль@host:3306/railway
```

### ❌ Сайт открывается, но API не работает (CORS ошибка)

**Решение**:
1. Проверьте переменную `CORS_ORIGINS` — должен быть URL вашего сайта
2. Проверьте логи: Render → **aurora** → **Logs** — ищите `CORS` или `origin`
3. После изменения CORS — перезапустите сервис

### ❌ Файлы не загружаются

**Причина**: Render использует эфемерную файловую систему — файлы пропадают после перезапуска.

**Решение**:
1. Настройте Cloudinary (см. пункт 4.4)
2. Или подключите Render Disk (платный план)

### ❌ Сервис падает при запуске

**Решение**:
1. Проверьте логи: Render → **aurora** → **Logs**
2. Частая причина — неверный `MYSQL_URL` или недоступная БД
3. Исправьте и нажмите **Manual Deploy**

### ❌ Ошибка: `Client does not support authentication protocol`

**Решение**:
```bash
# Подключитесь к Render MySQL и выполните:
ALTER USER 'aurora'@'%' IDENTIFIED WITH mysql_native_password BY 'ваш_пароль';
FLUSH PRIVILEGES;
```

### ❌ Push отклонён (large files)

Если снова ошибка о больших файлах:
```bash
# Найдите большие файлы в последних коммитах
git rev-list --objects --all | git cat-file --batch-check='%(objecttype) %(objectname) %(objectsize) %(rest)' | awk '/^blob/ {print $4, $3}' | sort -k2 -rn | head -10

# Добавьте их в .gitignore и выполните filter-branch заново
```

---

## Полезные ссылки

- [Render Dashboard](https://dashboard.render.com)
- [Render Documentation](https://render.com/docs)
- [Cloudinary](https://cloudinary.com)
- [Git репозиторий](https://github.com/kayanoooo/aurora)

---

*Гайд создан 07.07.2026. Актуален для Render Free Plan.*