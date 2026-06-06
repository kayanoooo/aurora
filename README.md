# aurora
aurora / better than max rly

## Railway database migration

The migration runner supports both Aurora variables (`MYSQL_HOST`, etc.) and
Railway MySQL variables (`MYSQLHOST`, etc.). It uses `server/migrate.sql`,
which is safe to run repeatedly.

```bash
# Validate the SQL locally without connecting to a database
python server/migrate_railway.py

# Run these through Railway CLI with the Aurora service selected
railway run python server/migrate_railway.py --ping
railway run python server/migrate_railway.py --apply
```

Before `--apply`, create a Railway database backup or snapshot.

### Move all database data to another Railway project

Load the old database variables and create one private SQL dump:

```bash
set -a
source server/.env
set +a
bash server/export_railway_database.sh
```

Then set the new Railway MySQL variables and import the dump:

```bash
bash server/import_railway_database.sh aurora_railway_export.sql
python server/migrate_railway.py --apply
```
