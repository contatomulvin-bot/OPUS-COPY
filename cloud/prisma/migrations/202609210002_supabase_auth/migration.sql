-- Switch MISTCUT Cloud authentication to Supabase Auth.
-- Passwords are no longer stored or verified by the MISTCUT Cloud database.

ALTER TABLE "User"
  ALTER COLUMN "passwordHash" DROP NOT NULL;
