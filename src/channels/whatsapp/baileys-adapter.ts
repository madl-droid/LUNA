import makeWASocket, {
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  DisconnectReason,
  type WASocket,
  type BaileysEventMap,
  type proto,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import { v4 as uuidv4 } from 'uuid';
import pino from 'pino';
import type { ChannelAdapter } from '../channel-adapter.js';
import type {
  IncomingMessage,
  OutgoingMessage,
  SendResult,
  MessageHandler,
  MessageContent,
} from '../types.js';
import { getConfig } from '../../config.js';

export class BaileysAdapter implements ChannelAdapter {
  readonly channelName = 'whatsapp';

  private socket: WASocket | null = null;
  private handlers: MessageHandler[] = [];
  private logger = pino({ level: 'silent' });

  async initialize(): Promise<void> {
    const cfg = getConfig().instance.whatsapp.baileys;
    const { state, saveCreds } = await useMultiFileAuthState(cfg.authDir);

    this.socket = makeWASocket({
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, this.logger),
      },
      printQRInTerminal: cfg.printQRInTerminal,
      syncFullHistory: cfg.syncFullHistory,
      logger: this.logger,
    });

    this.socket.ev.on('creds.update', saveCreds);

    this.socket.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect } = update;
      if (connection === 'close') {
        const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        if (shouldReconnect) {
          void this.initialize();
        }
      }
    });

    this.socket.ev.process(async (events: Partial<BaileysEventMap>) => {
      const upsert = events['messages.upsert'];
      if (upsert) {
        for (const msg of upsert.messages) {
          if (msg.key.fromMe) continue;
          const normalized = this.normalizeMessage(msg);
          if (!normalized) continue;

          for (const handler of this.handlers) {
            try {
              await handler(normalized);
            } catch (err) {
              console.error('[BaileysAdapter] Handler error:', err);
            }
          }
        }
      }
    });
  }

  async shutdown(): Promise<void> {
    if (this.socket) {
      this.socket.end(undefined);
      this.socket = null;
    }
  }

  async sendMessage(to: string, message: OutgoingMessage): Promise<SendResult> {
    if (!this.socket) {
      return { success: false, error: 'Socket not initialized' };
    }

    const jid = this.toJid(to);
    try {
      const content = this.toAnyMessageContent(message.content);
      const sent = await this.socket.sendMessage(jid, content, {
        quoted: undefined,
      });
      return {
        success: true,
        channelMessageId: sent?.key.id ?? undefined,
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      return { success: false, error };
    }
  }

  onMessage(handler: MessageHandler): void {
    this.handlers.push(handler);
  }

  private normalizeMessage(msg: proto.IWebMessageInfo): IncomingMessage | null {
    const key = msg.key;
    if (!key?.remoteJid) return null;
    const remoteJid = key.remoteJid;

    const content = this.extractContent(msg.message);
    if (!content) return null;

    return {
      id: uuidv4(),
      channelName: 'whatsapp',
      channelMessageId: key.id ?? '',
      from: remoteJid.replace(/@s\.whatsapp\.net$/, ''),
      fromName: msg.pushName ?? undefined,
      timestamp: new Date((msg.messageTimestamp as number) * 1000),
      content,
      isGroup: remoteJid.endsWith('@g.us'),
      groupId: remoteJid.endsWith('@g.us') ? remoteJid : undefined,
      quotedMessageId: msg.message?.extendedTextMessage?.contextInfo?.stanzaId ?? undefined,
      raw: msg,
    };
  }

  private extractContent(message: proto.IMessage | null | undefined): MessageContent | null {
    if (!message) return null;

    if (message.conversation) {
      return { type: 'text', text: message.conversation };
    }

    if (message.extendedTextMessage?.text) {
      return { type: 'text', text: message.extendedTextMessage.text };
    }

    if (message.imageMessage) {
      return {
        type: 'image',
        mimeType: message.imageMessage.mimetype ?? 'image/jpeg',
        caption: message.imageMessage.caption ?? undefined,
      };
    }

    if (message.audioMessage) {
      return {
        type: 'audio',
        mimeType: message.audioMessage.mimetype ?? 'audio/ogg',
      };
    }

    if (message.videoMessage) {
      return {
        type: 'video',
        mimeType: message.videoMessage.mimetype ?? 'video/mp4',
        caption: message.videoMessage.caption ?? undefined,
      };
    }

    if (message.documentMessage) {
      return {
        type: 'document',
        mimeType: message.documentMessage.mimetype ?? 'application/octet-stream',
        fileName: message.documentMessage.fileName ?? undefined,
      };
    }

    if (message.stickerMessage) {
      return {
        type: 'sticker',
        mimeType: message.stickerMessage.mimetype ?? 'image/webp',
      };
    }

    if (message.locationMessage) {
      return {
        type: 'location',
        latitude: message.locationMessage.degreesLatitude ?? 0,
        longitude: message.locationMessage.degreesLongitude ?? 0,
        name: message.locationMessage.name ?? undefined,
      };
    }

    if (message.reactionMessage) {
      return {
        type: 'reaction',
        emoji: message.reactionMessage.text ?? '',
        targetMessageId: message.reactionMessage.key?.id ?? '',
      };
    }

    return null;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private toAnyMessageContent(content: MessageContent): any {
    switch (content.type) {
      case 'text':
        return { text: content.text };
      case 'image':
        return {
          image: content.url ? { url: content.url } : content.buffer,
          caption: content.caption,
        };
      case 'audio':
        return {
          audio: content.url ? { url: content.url } : content.buffer,
          mimetype: content.mimeType,
        };
      case 'video':
        return {
          video: content.url ? { url: content.url } : content.buffer,
          caption: content.caption,
        };
      case 'document':
        return {
          document: content.url ? { url: content.url } : content.buffer,
          mimetype: content.mimeType,
          fileName: content.fileName,
        };
      case 'sticker':
        return {
          sticker: content.url ? { url: content.url } : content.buffer,
        };
      case 'location':
        return {
          location: {
            degreesLatitude: content.latitude,
            degreesLongitude: content.longitude,
          },
        };
      case 'reaction':
        return {
          react: {
            text: content.emoji,
            key: { id: content.targetMessageId },
          },
        };
      case 'contact':
        return {
          contacts: {
            contacts: [{ displayName: content.name, vcard: `BEGIN:VCARD\nVERSION:3.0\nFN:${content.name}\nTEL:${content.phone}\nEND:VCARD` }],
          },
        };
      default:
        return { text: '[Unsupported message type]' };
    }
  }

  private toJid(phone: string): string {
    const cleaned = phone.replace(/\D/g, '');
    return `${cleaned}@s.whatsapp.net`;
  }
}
