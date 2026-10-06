-- Fixed system role a category plays in internal flows, independent of
-- its user-editable display name (see Category.systemKey doc comment).
ALTER TABLE "categories" ADD COLUMN "system_key" TEXT;
CREATE UNIQUE INDEX "categories_system_key_key" ON "categories"("system_key");
