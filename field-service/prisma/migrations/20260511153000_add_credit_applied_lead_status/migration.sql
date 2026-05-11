ALTER TYPE "LeadStatus" ADD VALUE IF NOT EXISTS 'CREDIT_APPLIED';

-- One successful selected-provider credit application per lead/provider/action.
-- The existing wallet ledger remains the credit transaction table; this index
-- makes replayed WhatsApp webhooks and double taps unable to create a second
-- debit for the same accepted lead.
CREATE UNIQUE INDEX IF NOT EXISTS "ux_wallet_selected_lead_credit_application"
  ON "wallet_ledger_entries"("providerId", "referenceType", "referenceId")
  WHERE "entryType" = 'LEAD_UNLOCK_DEBIT'
    AND "referenceType" IN (
      'selected_lead_credit_application',
      'test_selected_lead_credit_application'
    );
