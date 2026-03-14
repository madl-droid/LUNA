export interface StoredMessage {
  id: string;
  sessionId: string;
  channelName: string;
  senderType: 'user' | 'agent';
  senderId: string;
  content: MessagePayload;
  createdAt: Date;
}

export interface MessagePayload {
  type: string;
  text?: string;
  mimeType?: string;
  caption?: string;
  summary?: string;
  [key: string]: unknown;
}

export interface SessionMeta {
  sessionId: string;
  contactId: string;
  channelName: string;
  startedAt: Date;
  lastActivityAt: Date;
  messageCount: number;
  compressed: boolean;
  compressionSummary?: string;
}
