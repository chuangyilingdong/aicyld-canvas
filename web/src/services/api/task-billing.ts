import { http, type HttpRequestConfig } from '@/services/api/request'
import { createGenerationTask, type CreateTaskInput, type GenerationTask } from '@/services/api/task-center'

export const GENERATION_QUOTE_TIMEOUT_MS = 15_000

export type BillingGenerationTask = GenerationTask & {
  billingStatus?: 'reserved' | 'settled' | 'refunded' | 'refund_pending' | 'pending_reconcile' | string
  billingPoints?: number
}

export type GenerationBillingQuote = {
  enabled: boolean
  points: number
  modelKey?: string
  displayName?: string
  ruleId?: string
  ruleVersion?: number
  balance?: number
  estimatedCostCny?: number
  breakdown?: Record<string, unknown>
}

export function quoteGenerationTask(input: CreateTaskInput, config?: HttpRequestConfig) {
  return http.post<GenerationBillingQuote>('/tasks/quote', input, { timeout: GENERATION_QUOTE_TIMEOUT_MS, ...config })
}

export async function createGenerationTaskWithConfirmation(
  input: CreateTaskInput,
  confirmTask?: (request: CreateTaskInput) => Promise<boolean>,
  config?: HttpRequestConfig,
) {
  if (confirmTask && !(await confirmTask(input))) throw new DOMException('用户取消生成', 'AbortError')
  if (config?.signal?.aborted) throw new DOMException('用户取消生成', 'AbortError')
  return createGenerationTask(input, config)
}
