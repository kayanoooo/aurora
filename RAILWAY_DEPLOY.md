# Aurora Railway Deploy

## Backend + web on one Railway host

This Dockerfile builds the React client and serves it from FastAPI. In Railway:

1. Create a MySQL service.
2. Create an Aurora service from this repository.
3. Add the backend variables. If you use Railway MySQL, prefer variable references from the MySQL service:

```env
MYSQLHOST=${{MySQL.MYSQLHOST}}
MYSQLPORT=${{MySQL.MYSQLPORT}}
MYSQLDATABASE=${{MySQL.MYSQLDATABASE}}
MYSQLUSER=${{MySQL.MYSQLUSER}}
MYSQLPASSWORD=${{MySQL.MYSQLPASSWORD}}
JWT_SECRET=replace-with-at-least-32-random-characters
CORS_ORIGINS=https://your-aurora-host.up.railway.app
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_USER=
SMTP_PASS=
SMTP_FROM=
SMTP_FROM_NAME=Aurora Messenger

# Email (HTTP API — рекомендуется для Railway, т.к. SMTP-порты блокируются)
# Выберите ОДНОГО провайдера ниже:

# --- Вариант A: SendGrid (100 писем/день бесплатно) ---
# 1. Регистрация: https://signup.sendgrid.com/
# 2. API Key: Settings → API Keys → Create API Key (Full Access)
# 3. Добавьте переменную:
SENDGRID_API_KEY=

# --- Вариант B: Resend (100 писем/день бесплатно) ---
# 1. Регистрация: https://resend.com
# 2. API Key: Dashboard → API Keys
# 3. Добавьте переменную:
RESEND_API_KEY=

# --- Вариант C: Mailgun (100 писем/день бесплатно) ---
# 1. Регистрация: https://mailgun.com
# 2. API Key: Settings → API Keys
# 3. Добавьте переменные:
MAILGUN_API_KEY=
MAILGUN_DOMAIN=

# --- Вариант D: Brevo (300 писем/день бесплатно) ---
# 1. Регистрация: https://brevo.com
# 2. API Key: SMTP & API → API Keys → Create
# 3. Добавьте переменную:
BREVO_API_KEY=

# Если вы задали несколько провайдеров, код сам определит рабочий.
# Можно указать конкретный через EMAIL_PROVIDER=sendgrid|resend|mailgun|brevo
EMAIL_PROVIDER=
```

Railway provides `PORT` automatically. The app listens on that port.
The app also understands `MYSQL_URL` / `DATABASE_URL` and the underscore aliases `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_DATABASE`, `MYSQL_USER`, `MYSQL_PASSWORD`.

## Client builds for Android and desktop

Use the same Railway host for native builds:

```env
REACT_APP_API_URL=https://your-aurora-host.up.railway.app/api
REACT_APP_WS_URL=wss://your-aurora-host.up.railway.app
```

Put those values in `client/.env.production` before building Android, Linux AppImage, or Windows packages.

## Cloudinary

If `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET` are set, uploads use Cloudinary. If they are empty, uploads fall back to local server storage.
