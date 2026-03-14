// LUNA — Channel adapter interface
// Interfaz abstracta que todo canal implementa.
// Para agregar un canal: crear un archivo que implemente ChannelAdapter.

import type { ChannelName, OutgoingMessage, SendResult, MessageHandler } from './types.js'

export interface ChannelAdapter {
  readonly channelName: ChannelName
  initialize(): Promise<void>
  shutdown(): Promise<void>
  sendMessage(to: string, message: OutgoingMessage): Promise<SendResult>
  onMessage(handler: MessageHandler): void
}
