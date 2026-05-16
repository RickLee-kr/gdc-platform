-- Second catalog for host pytest (API + lab continue to use gdc_test).
-- Runs once on empty data directory (docker-entrypoint-initdb.d).
CREATE DATABASE gdc_pytest OWNER gdc;
