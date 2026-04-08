// LUNA — Module: google-apps — Types
// Interfaces para autenticación Google OAuth2 y servicios (Drive, Sheets, Docs, Slides, Calendar).

// ═══════════════════════════════════════════
// Config del módulo (parsed from configSchema)
// ═══════════════════════════════════════════

export interface GoogleApiConfig {
  GOOGLE_CLIENT_ID: string
  GOOGLE_CLIENT_SECRET: string
  GOOGLE_REFRESH_TOKEN: string
  GOOGLE_ENABLED_SERVICES: string // comma-separated: 'drive,sheets,docs,slides,calendar'
  GOOGLE_TOKEN_REFRESH_BUFFER_MS: number
  GOOGLE_API_TIMEOUT_MS: number
  GOOGLE_API_RETRY_MAX: number
  GOOGLE_SHEETS_PROTECTED_IDS: string // comma-separated spreadsheet IDs protegidos contra escritura
}

// ═══════════════════════════════════════════
// OAuth state
// ═══════════════════════════════════════════

export interface GoogleAuthState {
  status: 'disconnected' | 'connected' | 'error' | 'refreshing'
  email: string | null
  scopes: string[]
  lastRefreshAt: Date | null
  expiresAt: Date | null
  error: string | null
}

export interface TokenInfo {
  accessToken: string
  refreshToken: string
  expiresAt: Date
  scopes: string[]
  email: string | null
}

// ═══════════════════════════════════════════
// Service toggles
// ═══════════════════════════════════════════

export type GoogleServiceName = 'drive' | 'sheets' | 'docs' | 'slides' | 'calendar' | 'gmail' | 'youtube'

export interface GoogleServiceStatus {
  name: GoogleServiceName
  enabled: boolean
  available: boolean
  lastUsedAt: Date | null
}

// ═══════════════════════════════════════════
// Drive types
// ═══════════════════════════════════════════

export interface DriveFile {
  id: string
  name: string
  mimeType: string
  size?: string
  createdTime?: string
  modifiedTime?: string
  parents?: string[]
  webViewLink?: string
  webContentLink?: string
  shared?: boolean
  owners?: Array<{ emailAddress: string; displayName: string }>
  sharingUser?: { emailAddress: string; displayName: string }
  permissions?: DrivePermission[]
}

export interface DrivePermission {
  id: string
  type: 'user' | 'group' | 'domain' | 'anyone'
  role: 'owner' | 'organizer' | 'fileOrganizer' | 'writer' | 'commenter' | 'reader'
  emailAddress?: string
  displayName?: string
}

export interface DriveListOptions {
  folderId?: string
  query?: string
  mimeType?: string
  pageSize?: number
  pageToken?: string
  orderBy?: string
  fields?: string
  includeSharedWithMe?: boolean
}

export interface DriveListResult {
  files: DriveFile[]
  nextPageToken?: string
}

// ═══════════════════════════════════════════
// Sheets types
// ═══════════════════════════════════════════

export interface SheetRange {
  spreadsheetId: string
  range: string
  values: string[][]
}

export interface SheetProperties {
  spreadsheetId: string
  title: string
  sheets: Array<{ sheetId: number; title: string; rowCount: number; columnCount: number }>
}

export interface SheetBatchOperation {
  type: 'write' | 'append' | 'clear' | 'find_replace'
  range?: string        // requerido para write, append, clear
  values?: string[][]   // requerido para write, append
  find?: string         // requerido para find_replace
  replacement?: string  // requerido para find_replace
  matchCase?: boolean   // opcional para find_replace
}

// ═══════════════════════════════════════════
// Docs types
// ═══════════════════════════════════════════

export interface DocInfo {
  documentId: string
  title: string
  body: string // plain text content
  revisionId?: string
  tabs?: Array<{ tabId: string; title: string; index: number }>
}

export interface DocEditOperation {
  type: 'append' | 'insert' | 'replace'
  text: string                // texto a insertar/agregar, o replaceText para replace
  searchText?: string         // solo para type='replace': texto a buscar
  index?: number              // solo para type='insert': posición (1-based, como Google Docs API)
}

// ═══════════════════════════════════════════
// Slides types
// ═══════════════════════════════════════════

export interface SlideInfo {
  presentationId: string
  title: string
  slides: Array<{ objectId: string; pageElements: number }>
  locale?: string
}

export interface SlideEditOperation {
  type: 'replace_text' | 'add_slide' | 'update_notes'
  // Para replace_text:
  searchText?: string
  replaceText?: string
  // Para add_slide:
  layout?: string
  insertionIndex?: number
  // Para update_notes:
  slideIndex?: number
  text?: string
}

// ═══════════════════════════════════════════
// Calendar types
// ═══════════════════════════════════════════

export interface CalendarEvent {
  id: string
  summary: string
  description?: string
  location?: string
  start: { dateTime?: string; date?: string; timeZone?: string }
  end: { dateTime?: string; date?: string; timeZone?: string }
  attendees?: CalendarAttendee[]
  organizer?: { email: string; displayName?: string; self?: boolean }
  status?: 'confirmed' | 'tentative' | 'cancelled'
  htmlLink?: string
  hangoutLink?: string
  meetLink?: string
  recurringEventId?: string
  created?: string
  updated?: string
}

export interface CalendarAttendee {
  email: string
  displayName?: string
  responseStatus?: 'needsAction' | 'declined' | 'tentative' | 'accepted'
  optional?: boolean
  organizer?: boolean
  self?: boolean
}

export interface CalendarListEntry {
  id: string
  summary: string
  description?: string
  primary?: boolean
  accessRole: 'freeBusyReader' | 'reader' | 'writer' | 'owner'
  timeZone?: string
  backgroundColor?: string
}

export interface CalendarEventListOptions {
  calendarId?: string
  timeMin?: string
  timeMax?: string
  query?: string
  maxResults?: number
  singleEvents?: boolean
  orderBy?: 'startTime' | 'updated'
  pageToken?: string
}

export interface CalendarEventCreateOptions {
  calendarId?: string
  summary: string
  description?: string
  location?: string
  start: { dateTime?: string; date?: string; timeZone?: string }
  end: { dateTime?: string; date?: string; timeZone?: string }
  attendees?: Array<{ email: string; displayName?: string; optional?: boolean }>
  sendUpdates?: 'all' | 'externalOnly' | 'none'
  reminders?: { useDefault: boolean; overrides?: Array<{ method: 'email' | 'popup'; minutes: number }> }
  addMeet?: boolean
  force?: boolean
}

export interface CalendarEventUpdateOptions {
  calendarId?: string
  eventId: string
  summary?: string
  description?: string
  location?: string
  start?: { dateTime?: string; date?: string; timeZone?: string }
  end?: { dateTime?: string; date?: string; timeZone?: string }
  attendees?: Array<{ email: string; displayName?: string; optional?: boolean }>
  sendUpdates?: 'all' | 'externalOnly' | 'none'
}

// ═══════════════════════════════════════════
// Calendar enhanced types (Plan 1)
// ═══════════════════════════════════════════

export interface CalendarCreateResult {
  created: boolean
  event?: CalendarEvent
  meetLink?: string | null
  conflicts?: string[]
  warning?: string
}

export interface CalendarAvailabilityOptions {
  emails: string[]
  date: string
  durationMinutes: number
  includeOwnCalendar?: boolean
}

export interface CalendarFreeSlot {
  start: string
  end: string
  durationMinutes: number
}

export interface CalendarAvailabilityResult {
  date: string
  busyPeople: string[]
  freeSlots: CalendarFreeSlot[]
  failedCalendars: string[]
  warnings: string[]
}

export interface CalendarSchedulingConfig {
  meetEnabled: boolean
  defaultReminders: Array<{ method: 'email' | 'popup'; minutes: number }>
  defaultDurationMinutes: number
  eventNamePrefix: string
  descriptionInstructions: string
  daysOff: Array<{ type: 'single'; date: string } | { type: 'range'; start: string; end: string }>
  followUpPost: { enabled: boolean; delayMinutes: number }
  followUpPre: { enabled: boolean; hoursBefore: number }
  schedulingRoles: Record<string, { enabled: boolean; instructions: string }>
  schedulingCoworkers: Record<string, { enabled: boolean; instructions: string }>
}
