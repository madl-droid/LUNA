// LUNA — Module: templates — Repository
// Raw SQL CRUD para doc_templates y doc_generated.

import type { Pool } from 'pg'
import type {
  DocTemplate,
  DocGenerated,
  CreateTemplateInput,
  UpdateTemplateInput,
  CreateDocInput,
  DocType,
  DocStatus,
  MimeType,
  SharingMode,
} from './types.js'

// ─── Mappers ───────────────────────────────────────────────────────────────

function rowToTemplate(row: Record<string, unknown>): DocTemplate {
  return {
    id: row['id'] as string,
    name: row['name'] as string,
    description: (row['description'] as string) ?? '',
    docType: row['doc_type'] as DocType,
    driveFileId: row['drive_file_id'] as string,
    mimeType: row['mime_type'] as MimeType,
    keys: typeof row['keys'] === 'string'
      ? JSON.parse(row['keys'])
      : (row['keys'] as Array<{ key: string; description: string }>) ?? [],
    folderPattern: (row['folder_pattern'] as string) ?? '',
    sharingMode: (row['sharing_mode'] as SharingMode) ?? 'anyone_with_link',
    enabled: row['enabled'] as boolean,
    createdAt: new Date(row['created_at'] as string),
    updatedAt: new Date(row['updated_at'] as string),
  }
}

function rowToGenerated(row: Record<string, unknown>): DocGenerated {
  return {
    id: row['id'] as string,
    templateId: row['template_id'] as string,
    contactId: (row['contact_id'] as string) ?? null,
    requesterSenderId: (row['requester_sender_id'] as string) ?? null,
    requesterChannel: (row['requester_channel'] as string) ?? null,
    driveFileId: row['drive_file_id'] as string,
    driveFolderId: (row['drive_folder_id'] as string) ?? null,
    webViewLink: row['web_view_link'] as string,
    docName: row['doc_name'] as string,
    keyValues: typeof row['key_values'] === 'string'
      ? JSON.parse(row['key_values'])
      : (row['key_values'] as Record<string, string>) ?? {},
    docType: row['doc_type'] as DocType,
    status: row['status'] as DocStatus,
    tags: typeof row['tags'] === 'string'
      ? JSON.parse(row['tags'])
      : (row['tags'] as Record<string, string>) ?? {},
    version: row['version'] as number,
    createdAt: new Date(row['created_at'] as string),
    updatedAt: new Date(row['updated_at'] as string),
  }
}

// ─── Template CRUD ─────────────────────────────────────────────────────────

export async function listTemplates(
  db: Pool,
  filters?: { docType?: DocType; enabled?: boolean },
): Promise<DocTemplate[]> {
  const conditions: string[] = []
  const values: unknown[] = []
  let idx = 1

  if (filters?.docType !== undefined) {
    conditions.push(`doc_type = $${idx++}`)
    values.push(filters.docType)
  }
  if (filters?.enabled !== undefined) {
    conditions.push(`enabled = $${idx++}`)
    values.push(filters.enabled)
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const res = await db.query(
    `SELECT * FROM doc_templates ${where} ORDER BY created_at DESC`,
    values,
  )
  return res.rows.map(rowToTemplate)
}

export async function getTemplate(db: Pool, id: string): Promise<DocTemplate | null> {
  const res = await db.query('SELECT * FROM doc_templates WHERE id = $1', [id])
  return res.rows[0] ? rowToTemplate(res.rows[0]) : null
}

export async function getTemplateByDriveId(db: Pool, driveFileId: string): Promise<DocTemplate | null> {
  const res = await db.query('SELECT * FROM doc_templates WHERE drive_file_id = $1', [driveFileId])
  return res.rows[0] ? rowToTemplate(res.rows[0]) : null
}

export async function createTemplate(db: Pool, input: CreateTemplateInput): Promise<DocTemplate> {
  const res = await db.query(
    `INSERT INTO doc_templates (name, description, doc_type, drive_file_id, mime_type, keys, folder_pattern, sharing_mode)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
     RETURNING *`,
    [
      input.name,
      input.description ?? '',
      input.docType,
      input.driveFileId,
      input.mimeType,
      JSON.stringify(input.keys),
      input.folderPattern ?? '',
      input.sharingMode ?? 'anyone_with_link',
    ],
  )
  return rowToTemplate(res.rows[0]!)
}

export async function updateTemplate(
  db: Pool,
  id: string,
  input: UpdateTemplateInput,
): Promise<DocTemplate | null> {
  const sets: string[] = ['updated_at = now()']
  const values: unknown[] = []
  let idx = 1

  if (input.name !== undefined) { sets.push(`name = $${idx++}`); values.push(input.name) }
  if (input.description !== undefined) { sets.push(`description = $${idx++}`); values.push(input.description) }
  if (input.docType !== undefined) { sets.push(`doc_type = $${idx++}`); values.push(input.docType) }
  if (input.keys !== undefined) { sets.push(`keys = $${idx++}::jsonb`); values.push(JSON.stringify(input.keys)) }
  if (input.folderPattern !== undefined) { sets.push(`folder_pattern = $${idx++}`); values.push(input.folderPattern) }
  if (input.sharingMode !== undefined) { sets.push(`sharing_mode = $${idx++}`); values.push(input.sharingMode) }
  if (input.enabled !== undefined) { sets.push(`enabled = $${idx++}`); values.push(input.enabled) }

  values.push(id)
  const res = await db.query(
    `UPDATE doc_templates SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
    values,
  )
  return res.rows[0] ? rowToTemplate(res.rows[0]) : null
}

export async function deleteTemplate(db: Pool, id: string): Promise<boolean> {
  // Detach generated documents so the template can be deleted (they keep their data)
  await db.query('UPDATE doc_generated SET template_id = NULL WHERE template_id = $1', [id])
  const res = await db.query('DELETE FROM doc_templates WHERE id = $1', [id])
  return (res.rowCount ?? 0) > 0
}

export async function getTemplatesByType(db: Pool, docType: DocType): Promise<DocTemplate[]> {
  const res = await db.query(
    'SELECT * FROM doc_templates WHERE doc_type = $1 AND enabled = true ORDER BY created_at DESC',
    [docType],
  )
  return res.rows.map(rowToTemplate)
}

// ─── Generated Docs CRUD ───────────────────────────────────────────────────

export async function getGenerated(db: Pool, id: string): Promise<DocGenerated | null> {
  const res = await db.query('SELECT * FROM doc_generated WHERE id = $1', [id])
  return res.rows[0] ? rowToGenerated(res.rows[0]) : null
}

export async function getGeneratedByDriveId(db: Pool, driveFileId: string): Promise<DocGenerated | null> {
  const res = await db.query('SELECT * FROM doc_generated WHERE drive_file_id = $1', [driveFileId])
  return res.rows[0] ? rowToGenerated(res.rows[0]) : null
}

export async function createGenerated(
  db: Pool,
  input: CreateDocInput & { driveFileId: string; driveFolderId?: string; webViewLink: string },
): Promise<DocGenerated> {
  // doc_type is derived from the template via subquery
  const res = await db.query(
    `INSERT INTO doc_generated
       (template_id, contact_id, requester_sender_id, requester_channel,
        drive_file_id, drive_folder_id, web_view_link, doc_name,
        key_values, doc_type, tags)
     SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, t.doc_type, $10::jsonb
     FROM doc_templates t WHERE t.id = $1
     RETURNING *`,
    [
      input.templateId,
      input.contactId ?? null,
      input.requesterSenderId ?? null,
      input.requesterChannel ?? null,
      input.driveFileId,
      input.driveFolderId ?? null,
      input.webViewLink,
      input.docName,
      JSON.stringify(input.keyValues),
      JSON.stringify(input.tags ?? {}),
    ],
  )
  if (!res.rows[0]) throw new Error(`Template ${input.templateId} not found`)
  return rowToGenerated(res.rows[0])
}

export async function updateGenerated(
  db: Pool,
  id: string,
  updates: Partial<{
    keyValues: Record<string, string>
    status: DocStatus
    version: number
    tags: Record<string, string>
    webViewLink: string
    driveFileId: string
  }>,
): Promise<DocGenerated | null> {
  const sets: string[] = ['updated_at = now()']
  const values: unknown[] = []
  let idx = 1

  if (updates.keyValues !== undefined) { sets.push(`key_values = $${idx++}::jsonb`); values.push(JSON.stringify(updates.keyValues)) }
  if (updates.status !== undefined) { sets.push(`status = $${idx++}`); values.push(updates.status) }
  if (updates.version !== undefined) { sets.push(`version = $${idx++}`); values.push(updates.version) }
  if (updates.tags !== undefined) { sets.push(`tags = $${idx++}::jsonb`); values.push(JSON.stringify(updates.tags)) }
  if (updates.webViewLink !== undefined) { sets.push(`web_view_link = $${idx++}`); values.push(updates.webViewLink) }
  if (updates.driveFileId !== undefined) { sets.push(`drive_file_id = $${idx++}`); values.push(updates.driveFileId) }

  values.push(id)
  const res = await db.query(
    `UPDATE doc_generated SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
    values,
  )
  return res.rows[0] ? rowToGenerated(res.rows[0]) : null
}

export async function searchGenerated(
  db: Pool,
  query?: {
    templateId?: string
    docType?: string
    tags?: Record<string, string>
    contactId?: string
    status?: string
    limit?: number
  },
): Promise<DocGenerated[]> {
  const conditions: string[] = []
  const values: unknown[] = []
  let idx = 1

  if (query?.templateId) { conditions.push(`template_id = $${idx++}`); values.push(query.templateId) }
  if (query?.docType) { conditions.push(`doc_type = $${idx++}`); values.push(query.docType) }
  if (query?.tags && Object.keys(query.tags).length > 0) {
    conditions.push(`tags @> $${idx++}::jsonb`)
    values.push(JSON.stringify(query.tags))
  }
  if (query?.contactId) { conditions.push(`contact_id = $${idx++}`); values.push(query.contactId) }
  if (query?.status) { conditions.push(`status = $${idx++}`); values.push(query.status) }

  const limit = query?.limit ?? 100
  values.push(limit)
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const res = await db.query(
    `SELECT * FROM doc_generated ${where} ORDER BY created_at DESC LIMIT $${idx}`,
    values,
  )
  return res.rows.map(rowToGenerated)
}
