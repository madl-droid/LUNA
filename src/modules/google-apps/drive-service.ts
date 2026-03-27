// LUNA — Module: google-apps — Drive Service
// CRUD de archivos y carpetas en Google Drive.

import { google } from 'googleapis'
import type { OAuth2Client } from 'google-auth-library'
import pino from 'pino'
import type {
  DriveFile,
  DriveListOptions,
  DriveListResult,
  DrivePermission,
  GoogleApiConfig,
} from './types.js'
import { googleApiCall } from './api-wrapper.js'
import { Readable } from 'node:stream'

const logger = pino({ name: 'google-apps:drive' })

export class DriveService {
  private drive
  // FIX: GA-3 — API timeout/retry config
  private apiConfig: { timeoutMs: number; maxRetries: number }

  constructor(
    private auth: OAuth2Client,
    private config: GoogleApiConfig,
  ) {
    this.drive = google.drive({ version: 'v3', auth })
    this.apiConfig = {
      timeoutMs: config.GOOGLE_API_TIMEOUT_MS ?? 30000,
      maxRetries: config.GOOGLE_API_RETRY_MAX ?? 2,
    }
  }

  async listFiles(options: DriveListOptions = {}): Promise<DriveListResult> {
    const queryParts: string[] = ["trashed = false"]

    if (options.folderId) {
      queryParts.push(`'${options.folderId}' in parents`)
    }
    if (options.mimeType) {
      queryParts.push(`mimeType = '${options.mimeType}'`)
    }
    if (options.query) {
      queryParts.push(`name contains '${options.query}'`)
    }
    if (options.includeSharedWithMe) {
      // No restringir por parents cuando buscamos archivos compartidos
      queryParts.push(`sharedWithMe = true`)
    }

    const q = queryParts.join(' and ')

    const res = await this.drive.files.list({
      q,
      pageSize: options.pageSize ?? 20,
      pageToken: options.pageToken,
      orderBy: options.orderBy ?? 'modifiedTime desc',
      fields: options.fields ?? 'nextPageToken, files(id, name, mimeType, size, createdTime, modifiedTime, parents, webViewLink, webContentLink, shared, owners, sharingUser)',
    })

    const files: DriveFile[] = (res.data.files ?? []).map((f) => ({
      id: f.id ?? '',
      name: f.name ?? '',
      mimeType: f.mimeType ?? '',
      size: f.size ?? undefined,
      createdTime: f.createdTime ?? undefined,
      modifiedTime: f.modifiedTime ?? undefined,
      parents: f.parents ?? undefined,
      webViewLink: f.webViewLink ?? undefined,
      webContentLink: f.webContentLink ?? undefined,
      shared: f.shared ?? undefined,
      owners: f.owners?.map((o) => ({
        emailAddress: o.emailAddress ?? '',
        displayName: o.displayName ?? '',
      })),
      sharingUser: f.sharingUser ? {
        emailAddress: f.sharingUser.emailAddress ?? '',
        displayName: f.sharingUser.displayName ?? '',
      } : undefined,
    }))

    return {
      files,
      nextPageToken: res.data.nextPageToken ?? undefined,
    }
  }

  async getFile(fileId: string): Promise<DriveFile> {
    const res = await this.drive.files.get({
      fileId,
      fields: 'id, name, mimeType, size, createdTime, modifiedTime, parents, webViewLink, webContentLink, shared, owners, sharingUser, permissions',
    })

    const f = res.data
    return {
      id: f.id ?? '',
      name: f.name ?? '',
      mimeType: f.mimeType ?? '',
      size: f.size ?? undefined,
      createdTime: f.createdTime ?? undefined,
      modifiedTime: f.modifiedTime ?? undefined,
      parents: f.parents ?? undefined,
      webViewLink: f.webViewLink ?? undefined,
      webContentLink: f.webContentLink ?? undefined,
      shared: f.shared ?? undefined,
      owners: f.owners?.map((o) => ({
        emailAddress: o.emailAddress ?? '',
        displayName: o.displayName ?? '',
      })),
      permissions: f.permissions?.map((p) => ({
        id: p.id ?? '',
        type: (p.type ?? 'user') as DrivePermission['type'],
        role: (p.role ?? 'reader') as DrivePermission['role'],
        emailAddress: p.emailAddress ?? undefined,
        displayName: p.displayName ?? undefined,
      })),
    }
  }

  async createFolder(name: string, parentId?: string): Promise<DriveFile> {
    const requestBody: Record<string, unknown> = {
      name,
      mimeType: 'application/vnd.google-apps.folder',
    }
    if (parentId) {
      requestBody.parents = [parentId]
    }

    const res = await this.drive.files.create({
      requestBody,
      fields: 'id, name, mimeType, createdTime, webViewLink, parents',
    })

    return {
      id: res.data.id ?? '',
      name: res.data.name ?? '',
      mimeType: res.data.mimeType ?? '',
      createdTime: res.data.createdTime ?? undefined,
      webViewLink: res.data.webViewLink ?? undefined,
      parents: res.data.parents ?? undefined,
    }
  }

  async createFile(
    name: string,
    mimeType: string,
    content: string | Buffer,
    parentId?: string,
  ): Promise<DriveFile> {
    const requestBody: Record<string, unknown> = { name, mimeType }
    if (parentId) {
      requestBody.parents = [parentId]
    }

    const media = {
      mimeType,
      body: typeof content === 'string'
        ? Readable.from([content])
        : Readable.from([content]),
    }

    const res = await this.drive.files.create({
      requestBody,
      media,
      fields: 'id, name, mimeType, size, createdTime, webViewLink, webContentLink',
    })

    return {
      id: res.data.id ?? '',
      name: res.data.name ?? '',
      mimeType: res.data.mimeType ?? '',
      size: res.data.size ?? undefined,
      createdTime: res.data.createdTime ?? undefined,
      webViewLink: res.data.webViewLink ?? undefined,
      webContentLink: res.data.webContentLink ?? undefined,
    }
  }

  async moveFile(fileId: string, newParentId: string, removeFromParent?: string): Promise<void> {
    await this.drive.files.update({
      fileId,
      addParents: newParentId,
      removeParents: removeFromParent,
      fields: 'id',
    })
  }

  async deleteFile(fileId: string): Promise<void> {
    // Mover a trash en vez de eliminar permanentemente
    await this.drive.files.update({
      fileId,
      requestBody: { trashed: true },
    })
  }

  async shareFile(
    fileId: string,
    email: string,
    role: 'reader' | 'writer' | 'commenter' = 'reader',
    sendNotification = true,
  ): Promise<DrivePermission> {
    const res = await this.drive.permissions.create({
      fileId,
      sendNotificationEmail: sendNotification,
      requestBody: {
        type: 'user',
        role,
        emailAddress: email,
      },
      fields: 'id, type, role, emailAddress, displayName',
    })

    return {
      id: res.data.id ?? '',
      type: (res.data.type ?? 'user') as DrivePermission['type'],
      role: (res.data.role ?? 'reader') as DrivePermission['role'],
      emailAddress: res.data.emailAddress ?? undefined,
      displayName: res.data.displayName ?? undefined,
    }
  }

  async removePermission(fileId: string, permissionId: string): Promise<void> {
    await this.drive.permissions.delete({ fileId, permissionId })
  }

  async downloadFile(fileId: string): Promise<Buffer> {
    const res = await googleApiCall(() => this.drive.files.get(
      { fileId, alt: 'media' },
      { responseType: 'arraybuffer' },
    ), this.apiConfig, 'drive.files.download')
    return Buffer.from(res.data as ArrayBuffer)
  }

  async exportFile(fileId: string, exportMimeType: string): Promise<string> {
    const res = await this.drive.files.export({
      fileId,
      mimeType: exportMimeType,
    })
    return String(res.data)
  }

  async getSharedWithMe(pageSize = 20, pageToken?: string): Promise<DriveListResult> {
    return this.listFiles({
      includeSharedWithMe: true,
      pageSize,
      pageToken,
    })
  }
}
