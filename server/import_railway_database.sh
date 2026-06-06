#!/usr/bin/env bash
set -Eeuo pipefail

# Imports a full Aurora SQL dump into a new Railway MySQL database.
# Usage:
#   export MYSQLHOST=... MYSQLPORT=... MYSQLUSER=... MYSQLPASSWORD=... MYSQLDATABASE=...
#   bash server/import_railway_database.sh aurora_railway_export.sql

INPUT_FILE="${1:-aurora_railway_export.sql}"

MYSQL_HOST="${MYSQL_HOST:-${MYSQLHOST:-}}"
MYSQL_PORT="${MYSQL_PORT:-${MYSQLPORT:-3306}}"
MYSQL_USER="${MYSQL_USER:-${MYSQLUSER:-}}"
MYSQL_PASSWORD="${MYSQL_PASSWORD:-${MYSQLPASSWORD:-}}"
MYSQL_DATABASE="${MYSQL_DATABASE:-${MYSQLDATABASE:-}}"

[[ -f "$INPUT_FILE" ]] || {
    echo "SQL dump not found: ${INPUT_FILE}" >&2
    exit 1
}

for variable in MYSQL_HOST MYSQL_PORT MYSQL_USER MYSQL_PASSWORD MYSQL_DATABASE; do
    if [[ -z "${!variable:-}" ]]; then
        echo "Missing required variable: ${variable}" >&2
        exit 1
    fi
done

command -v mysql >/dev/null 2>&1 || {
    echo "mysql client is not installed." >&2
    exit 1
}

defaults_file="$(mktemp)"
trap 'rm -f "$defaults_file"' EXIT
chmod 600 "$defaults_file"

cat > "$defaults_file" <<EOF
[client]
host=${MYSQL_HOST}
port=${MYSQL_PORT}
user=${MYSQL_USER}
password=${MYSQL_PASSWORD}
protocol=tcp
default-character-set=utf8mb4
EOF

echo "Importing ${INPUT_FILE} into ${MYSQL_DATABASE} at ${MYSQL_HOST}:${MYSQL_PORT}..."
mysql --defaults-extra-file="$defaults_file" "$MYSQL_DATABASE" < "$INPUT_FILE"
echo "Import completed successfully."
