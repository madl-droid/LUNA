export type MessageContentType = 'text' | 'image' | 'audio' | 'video' | 'document' | 'sticker' | 'location' | 'contact' | 'reaction';

export interface TextContent {
  type: 'text';
  text: string;
}

export interface MediaContent {
  type: 'image' | 'audio' | 'video' | 'document' | 'sticker';
  mimeType: string;
  url?: string;
  buffer?: Buffer;
  caption?: string;
  fileName?: string;
}

export interface LocationContent {
  type: 'location';
  latitude: number;
  longitude: number;
  name?: string;
}

export interface ContactContent {
  type: 'contact';
  name: string;
  phone: string;
}

export interface ReactionContent {
  type: 'reaction';
  emoji: string;
  targetMessageId: string;
}

export type MessageContent =
  | TextContent
  | MediaContent
  | LocationContent
  | ContactContent
  | ReactionContent;

export interface IncomingMessage {
  id: string;
  channelName: string;
  channelMessageId: string;
  from: string;
  fromName?: string;
  timestamp: Date;
  content: MessageContent;
  isGroup: boolean;
  groupId?: string;
  quotedMessageId?: string;
  raw?: unknown;
}

export interface OutgoingMessage {
  content: MessageContent;
  quotedMessageId?: string;
}

export interface SendResult {
  success: boolean;
  channelMessageId?: string;
  error?: string;
}

export type MessageHandler = (message: IncomingMessage) => void | Promise<void>;
