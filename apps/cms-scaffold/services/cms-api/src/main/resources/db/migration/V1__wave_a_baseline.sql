-- Wave A baseline. Connects Flyway to PostgreSQL 16.
-- Kernel system tables (cms_entry, cms_principal, cms_media, …) land in later waves.
-- Demo types are seeds, not DDL. Never CREATE TABLE album.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
