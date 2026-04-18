ALTER TABLE "addresses"
ADD COLUMN "addressLine1" TEXT,
ADD COLUMN "addressLine2" TEXT,
ADD COLUMN "complexName" TEXT,
ADD COLUMN "unitNumber" TEXT,
ADD COLUMN "region" TEXT;

ALTER TABLE "location_nodes"
ADD COLUMN "postalCode" TEXT;
