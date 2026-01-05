export type ToolRunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'

export interface ToolRunMeta {
  id: string // tool_use_id
  name: string
  input: Record<string, unknown>
  status: ToolRunStatus
  error?: string // raw engine error (e.g., tool_result_missing)
  synthetic?: boolean // true when we injected a result
  cancelledByUser?: boolean
  startTime: number
  endTime?: number
}

export const CANCELLATION_REASONS = {
  USER_CANCELLED: 'Operation cancelled by user (ESC pressed)',
  PROTOCOL_ERROR:
    'Tool response was lost during context processing. This is a recovered placeholder.',
  TIMEOUT: 'Operation timed out',
} as const
