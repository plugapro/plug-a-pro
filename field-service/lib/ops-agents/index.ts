// ─── Ops Agent Workflow Team — public surface ────────────────────────────────
// Framework spine (Task 1.2). Individual agent evaluators (Tasks 1.3+) live in
// their own subfolders and are registered with runAgent() by their cron/manual
// entry points.
//
// Design + task list: outputs/ops-agent-workflow-team/

export * from './types'
export * from './store'
export * from './runner'
export {
  captureRunStart,
  captureRunFinish,
  captureRecommendation,
  captureEscalation,
} from './openbrain'
