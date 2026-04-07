// LUNA — Extractors — Document to PDF Converter
// Convierte DOCX/PPTX a PDF usando LibreOffice headless.
// Usado por: DOCX con imágenes, PPTX local (no de Drive).

import { execFile } from 'node:child_process'
import { writeFile, readFile, unlink, mkdir, rmdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import pino from 'pino'

const logger = pino({ name: 'extractors:convert-pdf' })

/**
 * Convierte un documento (DOCX, PPTX, etc.) a PDF usando LibreOffice headless.
 * Retorna el PDF como Buffer, o null si la conversión falla.
 *
 * IMPORTANTE: LibreOffice debe estar instalado en el container.
 * En Alpine: apk add --no-cache libreoffice-writer libreoffice-impress libreoffice-calc
 */
export async function convertToPdf(
  input: Buffer,
  fileName: string,
): Promise<Buffer | null> {
  const tmpDir = join(tmpdir(), `luna-lopdf-${randomUUID()}`)
  await mkdir(tmpDir, { recursive: true })

  const inputPath = join(tmpDir, fileName)
  const expectedPdfName = fileName.replace(/\.[^.]+$/, '.pdf')
  const outputPath = join(tmpDir, expectedPdfName)

  try {
    await writeFile(inputPath, input)

    await new Promise<void>((resolve, reject) => {
      execFile(
        'libreoffice',
        ['--headless', '--convert-to', 'pdf', '--outdir', tmpDir, inputPath],
        { timeout: 120_000, maxBuffer: 10 * 1024 * 1024 },
        (err) => {
          if (err) reject(err)
          else resolve()
        },
      )
    })

    const pdfBuffer = await readFile(outputPath)
    logger.info({ fileName, pdfSize: pdfBuffer.length }, 'Converted to PDF')
    return pdfBuffer
  } catch (err) {
    logger.warn({ err, fileName }, 'LibreOffice PDF conversion failed')
    return null
  } finally {
    // Cleanup tmp files and directory
    await Promise.all([
      unlink(inputPath).catch(() => {}),
      unlink(outputPath).catch(() => {}),
    ])
    await rmdir(tmpDir).catch(() => {})
  }
}

let _libreOfficeAvailable: boolean | null = null

/**
 * Verifica si LibreOffice está disponible en el sistema.
 * Resultado cacheado — solo ejecuta `libreoffice --version` una vez por proceso.
 */
export async function isLibreOfficeAvailable(): Promise<boolean> {
  if (_libreOfficeAvailable !== null) return _libreOfficeAvailable
  try {
    await new Promise<void>((resolve, reject) => {
      execFile('libreoffice', ['--version'], { timeout: 10_000 }, (err) => {
        if (err) reject(err)
        else resolve()
      })
    })
    _libreOfficeAvailable = true
  } catch {
    _libreOfficeAvailable = false
  }
  return _libreOfficeAvailable
}
