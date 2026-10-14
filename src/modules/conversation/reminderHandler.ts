import type { ChatMessage } from '../../types/chat'
import { isExpectedAbortError } from '../../utils/isAbortError'

export interface ReminderData {
  taskId?: string
  message: string
  taskName?: string
  timestamp?: string
}

export interface ReminderHandlerDependencies {
  subscribe(handler: (data: ReminderData) => void): () => void
  subscribeAgentStatus?(
    handler: (data: AgentStatusData) => void
  ): () => void
  addMessage(message: ChatMessage): string
  enqueueSpeech(text: string): Promise<void>
  logInfo(...args: any[]): void
  logError(...args: any[]): void
}

export interface AgentStatusData {
  taskId: string
  status: 'completed' | 'failed' | 'cancelled'
  message: string
  timestamp?: string
}

export interface ReminderHandler {
  dispose(): void
}

export function createReminderHandler(
  dependencies: ReminderHandlerDependencies
): ReminderHandler {
  const deliveredReminderKeys = new Set<string>()
  const handleReminder = async (data: ReminderData) => {
    dependencies.logInfo('[ReminderHandler] Received scheduler reminder:', data)

    try {
      const deliveryKey = data.taskId
        ? `${data.taskId}:${data.timestamp || ''}`
        : undefined
      if (deliveryKey && deliveredReminderKeys.has(deliveryKey)) return
      if (deliveryKey) {
        deliveredReminderKeys.add(deliveryKey)
        if (deliveredReminderKeys.size > 200) {
          deliveredReminderKeys.delete(deliveredReminderKeys.values().next().value!)
        }
      }
      const reminderMessage: ChatMessage = {
        id: `reminder-${Date.now()}`,
        role: 'assistant',
        content: [
          {
            type: 'app_text',
            text: data.message,
            isScheduledReminder: true,
            taskName: data.taskName,
            timestamp: data.timestamp,
          },
        ],
        created_at: Date.now(),
      }

      dependencies.addMessage(reminderMessage)

      if (data.message && data.message.trim()) {
        await dependencies.enqueueSpeech(data.message)
      }
    } catch (error: any) {
      if (isExpectedAbortError(error)) {
        return
      }
      dependencies.logError(
        '[ReminderHandler] Failed to deliver scheduler reminder:',
        error
      )
    }
  }

  const unsubscribe = dependencies.subscribe(handleReminder)
  const unsubscribeAgentStatus = dependencies.subscribeAgentStatus?.(data => {
    dependencies.addMessage({
      id: `agent-status-${data.taskId}-${data.status}`,
      role: 'system',
      content: [
        {
          type: 'app_text',
          text: data.message,
          timestamp: data.timestamp,
        },
      ],
      created_at: Date.now(),
    })
  })

  return {
    dispose() {
      unsubscribe()
      unsubscribeAgentStatus?.()
    },
  }
}
