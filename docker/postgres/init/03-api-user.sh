#!/bin/sh
# Creates the API database user (agua_api). Its privileges are granted by migration 0015 on
# each database (main and test), so here it only gets LOGIN and its password.
set -e
psql -v ON_ERROR_STOP=1 -v api_password="${POSTGRES_API_PASSWORD:-agua_api_local}" \
  --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-'SQL'
  CREATE ROLE agua_api LOGIN PASSWORD :'api_password';
SQL
