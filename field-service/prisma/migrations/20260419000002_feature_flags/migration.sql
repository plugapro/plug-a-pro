CREATE TABLE "feature_flags" (
  "key"             TEXT NOT NULL,
  "enabled"         BOOLEAN NOT NULL DEFAULT false,
  "enabledForUsers" TEXT[]  NOT NULL DEFAULT '{}',
  "description"     TEXT,
  "updatedAt"       TIMESTAMP(3) NOT NULL,

  CONSTRAINT "feature_flags_pkey" PRIMARY KEY ("key")
);

-- Seed the 8 ops v2 flags (all disabled by default)
INSERT INTO "feature_flags" ("key", "enabled", "updatedAt") VALUES
  ('ops.v2.closeOut',        false, NOW()),
  ('ops.v2.notes',           false, NOW()),
  ('ops.v2.audit',           false, NOW()),
  ('ops.v2.breachBanner',    false, NOW()),
  ('ops.v2.dispatchOverride',false, NOW()),
  ('ops.v2.profileV2',       false, NOW()),
  ('ops.v2.bulkActions',     false, NOW()),
  ('ops.v2.duplicates',      false, NOW())
ON CONFLICT ("key") DO NOTHING;
