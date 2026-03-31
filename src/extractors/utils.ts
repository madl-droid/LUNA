// LUNA — Global Extractors — Utilities
// Funciones compartidas entre todos los extractores.

import { createHash } from 'node:crypto'

// ═══════════════════════════════════════════
// MIME / Extension resolution
// ═══════════════════════════════════════════

const EXT_TO_MIME: Record<string, string> = {
  // Text
  '.md': 'text/markdown',
  '.txt': 'text/plain',
  '.json': 'application/json',
  // Documents
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.doc': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  // Spreadsheets
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel',
  '.csv': 'text/csv',
  '.ods': 'application/vnd.oasis.opendocument.spreadsheet',
  // Presentations
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.odp': 'application/vnd.oasis.opendocument.presentation',
  // Images
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  // Audio
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.aiff': 'audio/aiff',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  '.opus': 'audio/opus',
  // Video
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.webm': 'video/webm',
  '.wmv': 'video/x-ms-wmv',
  '.3gp': 'video/3gpp',
  '.mpg': 'video/mpeg',
  '.mpeg': 'video/mpeg',
  '.flv': 'video/x-flv',
}

/**
 * Resuelve MIME type a partir de extensión si no se provee.
 */
export function resolveMimeType(fileName: string, providedMime?: string): string {
  if (providedMime && providedMime !== 'application/octet-stream') return providedMime
  const ext = fileName.substring(fileName.lastIndexOf('.')).toLowerCase()
  return EXT_TO_MIME[ext] ?? 'application/octet-stream'
}

/**
 * Lista de extensiones soportadas.
 */
export function getSupportedExtensions(): string[] {
  return Object.keys(EXT_TO_MIME)
}

// Google Docs native types (for Drive sync)
export const GOOGLE_NATIVE_TYPES: Record<string, string> = {
  'application/vnd.google-apps.document': 'text/plain',
  'application/vnd.google-apps.spreadsheet': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.google-apps.presentation': 'slides',
}

// ═══════════════════════════════════════════
// Detección de títulos implícitos
// ═══════════════════════════════════════════

/**
 * Detecta si una línea es un título implícito.
 * Criterios (al menos 2 deben cumplirse):
 * - Está toda en mayúsculas
 * - Tiene menos de 15 palabras
 * - Termina en ":"
 * - Va seguida de texto más largo
 * Devuelve true si es título implícito.
 */
export function isImplicitTitle(line: string, nextLine?: string): boolean {
  const trimmed = line.trim()
  if (!trimmed || trimmed.length < 3) return false

  const words = trimmed.split(/\s+/)
  let score = 0

  // ALL CAPS (solo letras, ignorar números y puntuación)
  const letters = trimmed.replace(/[^a-záéíóúñüA-ZÁÉÍÓÚÑÜ]/g, '')
  if (letters.length > 2 && letters === letters.toUpperCase()) score++

  // Menos de 15 palabras
  if (words.length < 15) score++

  // Termina en ":"
  if (trimmed.endsWith(':')) score++

  // Seguida de texto más largo
  if (nextLine) {
    const nextTrimmed = nextLine.trim()
    if (nextTrimmed.length > trimmed.length) score++
  }

  return score >= 2
}

// ═══════════════════════════════════════════
// MD5 hash
// ═══════════════════════════════════════════

/**
 * Calcula MD5 hash de un Buffer.
 */
export function computeMD5(buffer: Buffer): string {
  return createHash('md5').update(buffer).digest('hex')
}

// ═══════════════════════════════════════════
// Filtro de imágenes
// ═══════════════════════════════════════════

/**
 * Verifica si una imagen es demasiado pequeña (< minPx en algún eje).
 */
export function isSmallImage(width: number, height: number, minPx = 75): boolean {
  return width < minPx || height < minPx
}

// ═══════════════════════════════════════════
// Límites de tamaño
// ═══════════════════════════════════════════

/** Límite máximo de archivo para extracción (50MB) */
export const MAX_FILE_SIZE = 50 * 1024 * 1024

/** Límite máximo de imagen para extracción (20MB) */
export const MAX_IMAGE_SIZE = 20 * 1024 * 1024
