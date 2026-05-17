-- Add index on job_status_events.job_id for job history queries
CREATE INDEX IF NOT EXISTS "job_status_events_job_id_idx" ON "job_status_events"("jobId");

-- Add index on providers.completedJobsCount for catalogue ranking sort
CREATE INDEX IF NOT EXISTS "providers_completed_jobs_count_idx" ON "providers"("completedJobsCount");
