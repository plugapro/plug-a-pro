-- Provider admin review: more-info status and category approval support.

ALTER TYPE "ApplicationStatus" ADD VALUE IF NOT EXISTS 'MORE_INFO_REQUIRED';
