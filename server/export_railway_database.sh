#!/usr/bin/env bash
set -Eeuo pipefail

# Creates one Railway-compatible MySQL dump containing schema and data.
# Usage:
#   set -a; source server/.env; set +a
#   bash server/export_railway_database.sh [output.sql]

OUTPUT_FILE="${1:-aurora_railway_export.sql}"

MYSQL_HOST="${MYSQL_HOST:-${MYSQLHOST:-}}"
MYSQL_PORT="${MYSQL_PORT:-${MYSQLPORT:-3306}}"
MYSQL_USER="${MYSQL_USER:-${MYSQLUSER:-}}"
MYSQL_PASSWORD="${MYSQL_PASSWORD:-${MYSQLPASSWORD:-}}"
MYSQL_DATABASE="${MYSQL_DATABASE:-${MYSQLDATABASE:-}}"

for variable in MYSQL_HOST MYSQL_PORT MYSQL_USER MYSQL_PASSWORD MYSQL_DATABASE; do
    if [[ -z "${!variable:-}" ]]; then
        echo "Missing required variable: ${variable}" >&2
        exit 1
    fi
done

command -v mysqldump >/dev/null 2>&1 || {
    echo "mysqldump is not installed." >&2
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

echo "Exporting ${MYSQL_DATABASE} from ${MYSQL_HOST}:${MYSQL_PORT}..."

{
    printf '%s\n' \
        '-- Aurora Messenger full Railway export' \
        'SET NAMES utf8mb4;' \
        'SET FOREIGN_KEY_CHECKS=0;' \
        'SET UNIQUE_CHECKS=0;'

    mysqldump \
        --defaults-extra-file="$defaults_file" \
        --single-transaction \
        --quick \
        --hex-blob \
        --routines \
        --triggers \
        --events \
        --no-tablespaces \
        --skip-lock-tables \
        --set-charset \
        "$MYSQL_DATABASE"

    printf '%s\n' \
        'SET UNIQUE_CHECKS=1;' \
        'SET FOREIGN_KEY_CHECKS=1;'
} > "$OUTPUT_FILE"

echo "Created ${OUTPUT_FILE} ($(du -h "$OUTPUT_FILE" | cut -f1))."
echo "Keep this file private: it contains all database data."
