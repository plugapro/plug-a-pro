-- Add indexes to core models for status-filtered list queries.
-- All indexes use CREATE INDEX CONCURRENTLY to avoid table locks on large tables.

-- Match
CREATE INDEX CONCURRENTLY IF NOT EXISTS "matches_jobRequestId_idx" ON "matches"("jobRequestId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "matches_providerId_status_idx" ON "matches"("providerId", "status");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "matches_status_createdAt_idx" ON "matches"("status", "createdAt");

-- Quote
CREATE INDEX CONCURRENTLY IF NOT EXISTS "quotes_matchId_idx" ON "quotes"("matchId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "quotes_status_createdAt_idx" ON "quotes"("status", "createdAt");

-- Booking
CREATE INDEX CONCURRENTLY IF NOT EXISTS "bookings_status_createdAt_idx" ON "bookings"("status", "createdAt");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "bookings_matchId_idx" ON "bookings"("matchId");

-- Job
CREATE INDEX CONCURRENTLY IF NOT EXISTS "jobs_status_createdAt_idx" ON "jobs"("status", "createdAt");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "jobs_providerId_status_idx" ON "jobs"("providerId", "status");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "jobs_bookingId_idx" ON "jobs"("bookingId");

-- Payment
CREATE INDEX CONCURRENTLY IF NOT EXISTS "payments_status_createdAt_idx" ON "payments"("status", "createdAt");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "payments_bookingId_idx" ON "payments"("bookingId");

-- ProviderPayout
CREATE INDEX CONCURRENTLY IF NOT EXISTS "provider_payouts_status_createdAt_idx" ON "provider_payouts"("status", "createdAt");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "provider_payouts_providerId_createdAt_idx" ON "provider_payouts"("providerId", "createdAt");

-- Invoice
CREATE INDEX CONCURRENTLY IF NOT EXISTS "invoices_bookingId_idx" ON "invoices"("bookingId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "invoices_createdAt_idx" ON "invoices"("createdAt");

-- Dispute
CREATE INDEX CONCURRENTLY IF NOT EXISTS "disputes_status_createdAt_idx" ON "disputes"("status", "createdAt");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "disputes_jobId_idx" ON "disputes"("jobId");
