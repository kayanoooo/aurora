# Aurora Messenger — Deploy to Render

## Быстрый старт (через Blueprint)

1. Создайте аккаунт на [render.com](https://render.com) (GitHub login).

2. Нажмите **New + → Blueprint** и подключите ваш GitHub репозиторий.

3. Render автоматически найдёт `render.yaml` и создаст:
   - **MySQL** базу данных (`aurora-db`)
   - **Web Service** (`aurora`) из `Dockerfile.render`

4. После деплоя **обязательно** установите вручную в Environment Variables:
   - `JWT_SECRET` — сгенерируйте: `openssl rand -hex 32`
   - (Опционально) `CLOUDINARY_*` — для облачного хранения файлов
   - (Опционально) `SMTP_*` — для email-уведомлений

5. Готово! Ваше приложение будет доступно по адресу: `https://aurora.onrender.com`

---

## Ручная настройка (без Blueprint)

### 1. MySQL Database

- **New + → MySQL**
- Plan: **Free** (512MB)
- Region: **Frankfurt** (или ближайший к вам)
- Имя: `aurora-db`

После создания скопируйте **Internal Connection String** — она понадобится для Web Service.

### 2. Web Service

- **New + → Web Service**
- Build: **Docker**
- Name: `aurora`
- Region: тот же, что у MySQL
- Branch: `main`
- **Dockerfile Path**: `./Dockerfile.render`
- Plan: **Free**

### 3. Environment Variables (Web Service)

| Variable | Значение |
|----------|----------|
| `MYSQL_URL` | Internal Connection String из MySQL (Render подставляет автоматически) |
| `JWT_SECRET` | **Обязательно**. Сгенерируйте: `openssl rand -hex 32` |
| `CORS_ORIGINS` | `https://aurora.onrender.com` |
| `CLOUDINARY_CLOUD_NAME` | Опционально |
| `CLOUDINARY_API_KEY` | Опционально |
| `CLOUDINARY_API_SECRET` | Опционально |
| `SMTP_HOST` | `smtp.gmail.com` (опционально) |
| `SMTP_PORT` | `465` |
| `SMTP_USER` | Опционально |
| `SMTP_PASS` | Опционально |
| `SMTP_FROM` | Опционально |

Render сам устанавливает `PORT=10000` — приложение слушает на нём.

### 4. Health Check

Путь health check: `/api/health`  
Render будет проверять, что сервер отвечает, и перезапускать при падении.

---

## Миграция с Railway на Render

### Перенос базы данных

1. Экспортируйте дамп из Railway MySQL:
   ```bash
   mysqldump -h $MYSQLHOST -u $MYSQLUSER -p$MYSQLPASSWORD $MYSQLDATABASE > aurora_dump.sql
   ```

2. Подключитесь к Render MySQL (через `ps` или клиент):
   ```bash
   mysql -h <render-mysql-host> -u aurora -p messenger < aurora_dump.sql
   ```

3. Выполните миграции (они выполняются автоматически при старте сервера, но можно запустить вручную):
   ```bash
   python server/migrate_railway.py --apply
   ```

### Перенос файлов (если использовали локальное хранение)

Render использует эфемерную файловую систему — файлы исчезают после перезапуска сервиса.

**Рекомендуется** настроить Cloudinary (бесплатно до 25GB):
- Зарегистрируйтесь на [cloudinary.com](https://cloudinary.com)
- Добавьте `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`

Если хотите сохранить локальные файлы — используйте Render Disks (платный план).

---

## Нативные сборки (Android / Electron)

Так как Render не поддерживает Electron/Android билды, для них используйте локальную сборку:

```bash
# Соберите React клиент с переменными Render
REACT_APP_API_URL=https://aurora.onrender.com/api \
REACT_APP_WS_URL=wss://aurora.onrender.com \
npm run build

# Соберите Android (требуется Android SDK)
npx cap sync android
cd android && ./gradlew assembleDebug

# Соберите Electron AppImage
npx electron-builder --linux
```

---

## Переменные окружения для клиента (нативные сборки)

```env
REACT_APP_API_URL=https://aurora.onrender.com/api
REACT_APP_WS_URL=wss://aurora.onrender.com
```

Поместите их в `client/.env.production` перед сборкой.

---

## Отличия от Railway

| Характеристика | Railway | Render |
|----------------|---------|--------|
| **MySQL** | Встроенный сервис | Встроенный сервис (MySQL 8) |
| **Формат переменных БД** | `MYSQLHOST`, `MYSQLPORT`, ... | `MYSQL_URL` / `DATABASE_URL` |
| **Поддержка** | `*.up.railway.app` CORS | `*.onrender.com` CORS |
| **Наш config.py** | Поддерживает оба формата | Поддерживает оба формата |
| **Dockerfile** | Полный (включая Android/Electron) | Упрощённый (только веб) |
| **Файловое хранилище** | Cloudinary или локальное | Cloudinary (локальное непостоянно) |
| **Бесплатный план** | 500ч/мес, сон при неактивности | 750ч/мес, сон при неактивности |

---

## Обновление после деплоя

Просто пушите в GitHub — Render автоматически пересоберёт и перезапустит сервис.