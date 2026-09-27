-- Superadmin lives outside clubs: users.club_id becomes nullable.
-- App rule (unchanged): visitor/associate/admin always carry a club_id;
-- only role=superadmin rows may be NULL. Partial unique indexes treat NULL
-- club_id as distinct, so superadmin uniqueness rests on the bootstrap guard.
ALTER TABLE "users" ALTER COLUMN "club_id" DROP NOT NULL;
