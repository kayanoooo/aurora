# Aurora Messenger

A feature-rich messenger application with FastAPI backend, React frontend, WebSocket real-time messaging, and native mobile/desktop support via Capacitor and Electron.

## Deploy

### Render (рекомендуется)

См. [RENDER_DEPLOY.md](./RENDER_DEPLOY.md) — полная инструкция по деплою на Render.

### Railway (legacy)

См. [RAILWAY_DEPLOY.md](./RAILWAY_DEPLOY.md) — инструкция для Railway.

## Database migration

The migration runner supports all variable naming conventions:
- Aurora vars: `MYSQL_HOST`, `MYSQL_PORT`, etc.
- Railway vars: `MYSQLHOST`, `MYSQLPORT`, etc.
- Render/connection string: `DATABASE_URL`, `MYSQL_URL`

It uses `server/migrate.sql`, which is safe to run repeatedly.

```bash
# Validate the SQL locally without connecting to a database
python server/migrate_railway.py

# Apply migrations against any MySQL host
python server/migrate_railway.py --ping
python server/migrate_railway.py --apply
```

Before `--apply`, create a database backup or snapshot.

### Move all database data to another project

Load the old database variables and create one private SQL dump:

```bash
set -a
source server/.env
set +a
bash server/export_railway_database.sh
```

Then set the new MySQL variables and import the dump:

```bash
bash server/import_railway_database.sh aurora_railway_export.sql
python server/migrate_railway.py --apply
```

## Environment variables reference

All supported variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` / `MYSQL_URL` | — | MySQL connection string (Render format) |
| `MYSQL_HOST` / `MYSQLHOST` | `localhost` | MySQL host |
| `MYSQL_PORT` / `MYSQLPORT` | `3307` | MySQL port |
| `MYSQL_USER` / `MYSQLUSER` | `user` | MySQL user |
| `MYSQL_PASSWORD` / `MYSQLPASSWORD` | `userpassword` | MySQL password |
| `MYSQL_DATABASE` / `MYSQLDATABASE` | `messenger` | MySQL database name |
| `PORT` | `8000` | Server port (Render/Railway set this automatically) |
| `JWT_SECRET` | — | **Required.** Secret key for JWT tokens |
| `CORS_ORIGINS` | — | Comma-separated additional CORS origins |
| `CLOUDINARY_CLOUD_NAME` | — | Cloudinary cloud name (file uploads) |
| `CLOUDINARY_API_KEY` | — | Cloudinary API key |
| `CLOUDINARY_API_SECRET` | — | Cloudinary API secret |
| `SMTP_HOST` | `smtp.gmail.com` | SMTP server for emails |
| `SMTP_PORT` | `465` | SMTP port |
| `SMTP_USER` | — | SMTP username |
| `SMTP_PASS` | — | SMTP password |
| `SMTP_FROM` | — | From email address |
| `SMTP_FROM_NAME` | `Aurora Messenger` | From name |
