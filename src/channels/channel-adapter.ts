import type { OutgoingMessage, SendResult, MessageHandler } from './types.js';

export interface ChannelAdapter {
  readonly channelName: string;

  initialize(): Promise<void>;

  shutdown(): Promise<void>;

  sendMessage(to: string, message: OutgoingMessage): Promise<SendResult>;

  onMessage(handler: MessageHandler): void;
}
