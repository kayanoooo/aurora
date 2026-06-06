#!/usr/bin/env python3
"""Apply Aurora's idempotent MySQL migration to a Railway database."""

import argparse
import os
import sys
from pathlib import Path
from urllib.parse import unquote, urlparse

import pymysql


DEFAULT_SQL_FILE = Path(__file__).with_name("migrate.sql")


def env_value(*names: str, default: str = "") -> str:
    for name in names:
        value = os.getenv(name)
        if value:
            return value
    return default


def database_config() -> dict:
    database_url = env_value("MYSQL_URL", "DATABASE_URL")
    parsed = urlparse(database_url) if database_url.startswith(("mysql://", "mysql+pymysql://")) else None

    host = env_value("MYSQL_HOST", "MYSQLHOST", default=parsed.hostname if parsed else "")
    port = env_value("MYSQL_PORT", "MYSQLPORT", default=str(parsed.port if parsed and parsed.port else 3306))
    user = env_value("MYSQL_USER", "MYSQLUSER", default=unquote(parsed.username or "") if parsed else "")
    password = env_value(
        "MYSQL_PASSWORD",
        "MYSQLPASSWORD",
        default=unquote(parsed.password or "") if parsed else "",
    )
    database = env_value(
        "MYSQL_DATABASE",
        "MYSQLDATABASE",
        default=parsed.path.lstrip("/") if parsed else "",
    )

    missing = [
        name
        for name, value in {
            "MYSQL_HOST/MYSQLHOST": host,
            "MYSQL_USER/MYSQLUSER": user,
            "MYSQL_PASSWORD/MYSQLPASSWORD": password,
            "MYSQL_DATABASE/MYSQLDATABASE": database,
        }.items()
        if not value
    ]
    if missing:
        raise ValueError(f"Missing database variables: {', '.join(missing)}")

    return {
        "host": host,
        "port": int(port),
        "user": user,
        "password": password,
        "database": database,
        "charset": "utf8mb4",
        "connect_timeout": 20,
        "read_timeout": 120,
        "write_timeout": 120,
        "autocommit": True,
    }


def parse_sql_script(content: str) -> list[str]:
    """Split a mysql-client style script, including DELIMITER directives."""
    delimiter = ";"
    buffer: list[str] = []
    statements: list[str] = []

    for raw_line in content.splitlines():
        stripped = raw_line.strip()

        if stripped.upper().startswith("DELIMITER "):
            if any(line.strip() for line in buffer):
                raise ValueError("DELIMITER changed before the previous statement ended")
            delimiter = stripped.split(maxsplit=1)[1]
            continue

        buffer.append(raw_line)
        if stripped.endswith(delimiter):
            statement = "\n".join(buffer).rstrip()
            statement = statement[: -len(delimiter)].rstrip()
            if statement and not all(
                line.lstrip().startswith("--") or not line.strip()
                for line in statement.splitlines()
            ):
                statements.append(statement)
            buffer = []

    if any(line.strip() and not line.lstrip().startswith("--") for line in buffer):
        raise ValueError("SQL file ends with an incomplete statement")

    return statements


def statement_label(statement: str) -> str:
    meaningful = [
        line.strip()
        for line in statement.splitlines()
        if line.strip() and not line.lstrip().startswith("--")
    ]
    return (meaningful[0] if meaningful else "SQL statement")[:100]


def connect(config: dict):
    print(
        f"Connecting to MySQL at {config['host']}:{config['port']} "
        f"as {config['user']} (database: {config['database']})"
    )
    connection = pymysql.connect(**config)
    with connection.cursor() as cursor:
        cursor.execute("SELECT VERSION(), DATABASE()")
        version, database = cursor.fetchone()
    print(f"Connected to MySQL {version}; selected database: {database}")
    return connection


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sql", type=Path, default=DEFAULT_SQL_FILE, help="SQL migration file")
    parser.add_argument("--ping", action="store_true", help="Only test the database connection")
    parser.add_argument("--apply", action="store_true", help="Apply the migration to the database")
    args = parser.parse_args()

    if args.ping and args.apply:
        parser.error("--ping and --apply cannot be used together")

    statements = parse_sql_script(args.sql.read_text(encoding="utf-8"))
    print(f"Validated {args.sql}: {len(statements)} SQL statements")

    if not args.ping and not args.apply:
        print("Validation only. Use --ping to test Railway or --apply to update the database.")
        return 0

    config = database_config()
    connection = connect(config)
    try:
        if args.ping:
            print("Database connection is healthy.")
            return 0

        with connection.cursor() as cursor:
            for index, statement in enumerate(statements, start=1):
                print(f"[{index}/{len(statements)}] {statement_label(statement)}")
                cursor.execute(statement)
        print("Migration completed successfully.")
        return 0
    finally:
        connection.close()


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"Migration failed: {error}", file=sys.stderr)
        raise SystemExit(1)
