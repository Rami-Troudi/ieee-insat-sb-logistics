-- Remove legacy plaintext staff passwords from application data.
UPDATE app_users
SET data = json_remove(data, '$.password'),
    updated_at = strftime('%s','now') * 1000
WHERE json_valid(data) AND json_type(data, '$.password') IS NOT NULL;

-- Password authentication is disabled. Clear any legacy Better Auth password hashes
-- that may have been created before the passwordless staff flow was introduced.
UPDATE account
SET password = NULL,
    updatedAt = strftime('%s','now') * 1000
WHERE password IS NOT NULL;
