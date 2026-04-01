// LUNA — Knowledge Description Generator
// Generates LLM-powered descriptions and keywords for knowledge documents.
// Runs after chunking, before embedding (Option A).
// Preserves admin description; LLM description stored separately.

import type pino from 'pino'

// ═══════════════════════════════════════════
// Types
// ═══════════════════════════════════════════

export interface GeneratedDescription {
  description: string   // concise but precise description of the content
  keywords: string[]    // searchable keywords not necessarily in the text
}

interface LLMService {
  callHook(hook: 'llm:chat', payload: {
    task: string
    system: string
    messages: Array<{ role: 'user'; content: string }>
    maxTokens: number
    temperature: number
  }): Promise<{ text?: string } | null>
}

interface ChunkSample {
  content: string
  section: string | null
  contentType: string
  chunkIndex: number
  chunkTotal: number
}

// ═══════════════════════════════════════════
// Sample selection — pick representative chunks
// ═══════════════════════════════════════════

/**
 * Select a representative sample of chunks for description generation.
 * Strategy: first, ~25%, ~50% (x2 for mid coverage), ~75%, last.
 * Max 6 chunks to keep input under ~5000 tokens.
 */
export function selectSampleChunks(chunks: ChunkSample[]): ChunkSample[] {
  if (chunks.length === 0) return []
  if (chunks.length <= 6) return chunks

  const indices = new Set<number>()
  indices.add(0)                                       // first (intro)
  indices.add(Math.floor(chunks.length * 0.25))        // ~25%
  indices.add(Math.floor(chunks.length * 0.45))        // ~45% (mid-left)
  indices.add(Math.floor(chunks.length * 0.55))        // ~55% (mid-right)
  indices.add(Math.floor(chunks.length * 0.75))        // ~75%
  indices.add(chunks.length - 1)                       // last (conclusion)

  return Array.from(indices)
    .sort((a, b) => a - b)
    .map(i => chunks[i]!)
}

// ═══════════════════════════════════════════
// LLM description generation
// ═══════════════════════════════════════════

/**
 * Generate an LLM description and keywords for a knowledge document.
 * Uses sampled chunks to create a precise description of the actual content.
 *
 * @param title         Document title
 * @param adminDesc     Admin-provided description (used as hint)
 * @param chunks        All chunks of the document
 * @param llm           Registry with callHook for LLM
 * @param logger        Pino logger
 * @returns Generated description + keywords, or null if LLM fails
 */
export async function generateDescription(
  title: string,
  adminDesc: string,
  chunks: ChunkSample[],
  llm: LLMService,
  logger: pino.Logger,
): Promise<GeneratedDescription | null> {
  if (chunks.length === 0) return null

  const samples = selectSampleChunks(chunks)

  // Build content sample (cap at ~4500 words ≈ ~6000 tokens)
  const MAX_SAMPLE_WORDS = 4500
  let wordCount = 0
  const sampleParts: string[] = []

  for (const chunk of samples) {
    const text = chunk.content.trim()
    if (!text) continue

    const words = text.split(/\s+/)
    const remaining = MAX_SAMPLE_WORDS - wordCount
    if (remaining <= 0) break

    const slice = words.length > remaining ? words.slice(0, remaining).join(' ') + '...' : text
    const label = chunk.section ? `[${chunk.section}]` : `[Chunk ${chunk.chunkIndex + 1}/${chunk.chunkTotal}]`
    sampleParts.push(`${label}\n${slice}`)
    wordCount += Math.min(words.length, remaining)
  }

  if (sampleParts.length === 0) return null

  const contentSample = sampleParts.join('\n\n---\n\n')

  const userContent = `Analiza este documento y genera una descripción precisa y palabras clave.

TÍTULO: ${title}
DESCRIPCIÓN DEL ADMIN: ${adminDesc || '(sin descripción)'}

MUESTRA DEL CONTENIDO (${chunks.length} secciones totales, mostrando ${samples.length}):
${contentSample}

Responde SOLO con JSON válido:
{
  "description": "Descripción precisa del documento en 2-3 oraciones. Incluye: qué es, qué contiene específicamente (datos, tablas, especificaciones, instrucciones), y para qué sirve.",
  "keywords": ["keyword1", "keyword2", "..."]
}

Reglas:
- La descripción debe ser ESPECÍFICA al contenido real, no genérica
- Menciona datos concretos: nombres de productos, rangos de precios, países, especificaciones técnicas si aparecen
- Keywords: 5-15 términos relevantes para búsqueda que complementen el texto (sinónimos, categorías, términos técnicos)
- Responde en el mismo idioma del contenido`

  try {
    const result = await llm.callHook('llm:chat', {
      task: 'knowledge-description',
      system: 'Eres un bibliotecario experto que cataloga documentos. Generas descripciones precisas y keywords útiles para búsqueda.',
      messages: [{ role: 'user' as const, content: userContent }],
      maxTokens: 500,
      temperature: 0.2,
    })

    if (!result?.text) {
      logger.warn({ title }, '[DESC-GEN] LLM returned no text')
      return null
    }

    const parsed = parseJSON(result.text)
    if (!parsed?.description) {
      logger.warn({ title, text: result.text.slice(0, 200) }, '[DESC-GEN] Failed to parse LLM response')
      return null
    }

    const description = String(parsed.description).slice(0, 1000)
    const keywords = Array.isArray(parsed.keywords)
      ? (parsed.keywords as unknown[]).map(k => String(k).toLowerCase().trim()).filter(k => k.length > 0).slice(0, 20)
      : []

    logger.info({ title, descLength: description.length, keywordCount: keywords.length }, '[DESC-GEN] Description generated')
    return { description, keywords }
  } catch (err) {
    logger.error({ err, title }, '[DESC-GEN] Failed to generate description')
    return null
  }
}

// ═══════════════════════════════════════════
// Helper
// ═══════════════════════════════════════════

function parseJSON(text: string): Record<string, unknown> | null {
  try {
    let jsonStr = text.trim()
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '')
    }
    return JSON.parse(jsonStr)
  } catch {
    return null
  }
}
