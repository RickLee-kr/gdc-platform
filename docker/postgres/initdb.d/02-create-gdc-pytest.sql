-- Second catalog for host pytest (API + lab continue to use gdc).
-- Runs once on empty data directory (docker-entrypoint-initdb.d).
CREATE DATABASE gdc_pytest OWNER gdc;
