-- M1-T2: Add CustomerMember model for operator/staff access

-- 1. New customer_members table
CREATE TABLE "customer_members" (
    "id"                  TEXT NOT NULL,
    "principalCustomerId" TEXT NOT NULL,
    "memberUserId"        TEXT NOT NULL,
    "memberName"          TEXT NOT NULL,
    "memberPhone"         TEXT NOT NULL,
    "role"                TEXT NOT NULL DEFAULT 'BOOKER',
    "active"              BOOLEAN NOT NULL DEFAULT true,
    "addedAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_members_pkey" PRIMARY KEY ("id")
);

-- 2. FK: customer_members → customers (principalCustomerId)
ALTER TABLE "customer_members"
    ADD CONSTRAINT "customer_members_principalCustomerId_fkey"
    FOREIGN KEY ("principalCustomerId") REFERENCES "customers"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
