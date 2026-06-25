-- AlterEnum: Tier 1 funnel observability — add granular request + lead lifecycle event types
ALTER TYPE "WorkflowEventType" ADD VALUE 'REQUEST_STARTED';
ALTER TYPE "WorkflowEventType" ADD VALUE 'REQUEST_SUBMITTED';
ALTER TYPE "WorkflowEventType" ADD VALUE 'PROVIDER_NOTIFIED';
ALTER TYPE "WorkflowEventType" ADD VALUE 'PROVIDER_VIEWED';
ALTER TYPE "WorkflowEventType" ADD VALUE 'PROVIDER_ACCEPTED';
ALTER TYPE "WorkflowEventType" ADD VALUE 'PROVIDER_DECLINED';
ALTER TYPE "WorkflowEventType" ADD VALUE 'CLIENT_NOTIFIED';
