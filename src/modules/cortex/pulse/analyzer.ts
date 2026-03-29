// cortex/pulse/analyzer.ts — LLM analysis for Pulse reports
// Takes curated data package, calls LLM, returns structured PulseReport.

import type { Registry } from '../../../kernel/registry.js'
import type {
  PulseConfig,
  PulseDataPackage,
  PulseReport,
  PulseReportMode,
  PulseMetricsSummary,
} from '../types.js'
import pino from 'pino'

const logger = pino({ name: 'cortex:pulse:analyzer' })

const SYSTEM_PROMPT = `Eres un ingeniero de sistemas analizando métricas de un agente de IA que atiende leads por WhatsApp y Email.
Tu trabajo es identificar problemas, diagnosticar causas raíz, y recomendar soluciones prácticas.

Responde SOLO con JSON válido siguiendo el schema proporcionado.
No incluyas markdown, backticks, ni texto fuera del JSON.

Para cada incidente, proporciona:
- what: qué pasó (1 oración)
- impact: cuántos mensajes/leads se afectaron
- root_cause: causa raíz más probable
- immediate_fix: qué hacer ahora
- long_term_fix: qué hacer para que no se repita

Las recomendaciones deben ser accionables y específicas.
No recomiendes "monitorear más" — ya se está monitoreando.
Recomienda cambios concretos con valores específicos.`

export interface AnalysisResult {
  report: PulseReport
  modelUsed: string
  tokensUsed: number
}

/**
 * Analyze data package using LLM and produce a structured report.
 */
export async function analyze(
  registry: Registry,
  data: PulseDataPackage,
  config: PulseConfig,
  mode: PulseReportMode,
): Promise<AnalysisResult> {
  const incidentCount = data.alerts.filter(a => a.state !== 'resolved' || a.duration_seconds === null || a.duration_seconds > 60).length
  const shouldEscalate = incidentCount >= config.CORTEX_PULSE_LLM_ESCALATION_THRESHOLD

  const model = shouldEscalate
    ? config.CORTEX_PULSE_LLM_ESCALATION_MODEL
    : config.CORTEX_PULSE_LLM_DEFAULT_MODEL

  const task = resolveTask(model)

  const userMessage = buildUserMessage(data)

  logger.debug({
    model,
    task,
    incidentCount,
    escalated: shouldEscalate,
    mode,
  }, 'Calling LLM for Pulse analysis')

  try {
    const result = await registry.callHook('llm:chat', {
      task,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
      maxTokens: 4096,
      temperature: 0.1,
      jsonMode: true,
    })

    if (!result?.text) {
      throw new Error('LLM returned empty response')
    }

    const parsed = parseResponse(result.text, data)

    return {
      report: {
        period: data.period_start.slice(0, 10),
        period_start: data.period_start,
        period_end: data.period_end,
        ...parsed,
      },
      modelUsed: result.model ?? model,
      tokensUsed: (result.inputTokens ?? 0) + (result.outputTokens ?? 0),
    }
  } catch (err) {
    logger.error({ err, model }, 'LLM analysis failed')
    throw err
  }
}

/**
 * Generate a simple healthy report without calling the LLM.
 */
export function generateQuietReport(data: PulseDataPackage): AnalysisResult {
  const messagesProcessed = data.metrics.pipeline.count + data.metrics.hourly.pipeline

  return {
    report: {
      period: data.period_start.slice(0, 10),
      period_start: data.period_start,
      period_end: data.period_end,
      overall_health: 'healthy',
      summary: `Sistema saludable. ${messagesProcessed} mensajes procesados, 0 incidentes.`,
      incidents: [],
      metrics_summary: buildMetricsSummary(data),
      recommendations: [],
    },
    modelUsed: 'none',
    tokensUsed: 0,
  }
}

// ─── Helpers ─────────────────────────────

function resolveTask(model: string): string {
  // Use cortex-pulse task name so the LLM gateway routes to the cortex API key group
  // in advanced mode. The alias resolves to 'complex' for model routing.
  if (model.includes('sonnet')) return 'cortex-pulse'
  return 'cortex-pulse' // always use cortex group for Pulse analysis
}

function buildUserMessage(data: PulseDataPackage): string {
  const sections: string[] = []

  sections.push(`Período: ${data.period_start} a ${data.period_end}`)

  // Alerts
  if (data.alerts.length > 0) {
    sections.push('\n## Alertas del período')
    for (const a of data.alerts) {
      const dur = a.duration_seconds != null ? ` (duración: ${a.duration_seconds}s)` : ' (sin resolver)'
      const flap = a.flapCount > 0 ? ` [flapping ${a.flapCount}x]` : ''
      sections.push(`- [${a.severity.toUpperCase()}] ${a.rule}: ${a.message}${dur}${flap}`)
    }
  }

  // Metrics
  sections.push('\n## Métricas actuales')
  sections.push(`Pipeline: ${data.metrics.pipeline.count} mensajes, ${data.metrics.pipeline.errors} errores, latencia avg ${data.metrics.pipeline.latency_avg}ms, max ${data.metrics.pipeline.latency_max}ms`)
  sections.push(`LLM: ${data.metrics.llm.calls} llamadas, ${data.metrics.llm.errors} errores, ${data.metrics.llm.fallbacks} fallbacks, ${data.metrics.llm.tokens_in + data.metrics.llm.tokens_out} tokens totales`)
  sections.push(`Tools: ${data.metrics.tools.calls} llamadas, ${data.metrics.tools.errors} errores`)

  // Hourly trends
  if (data.hourly_metrics.length > 0) {
    sections.push('\n## Tendencia por hora')
    for (const h of data.hourly_metrics) {
      sections.push(`- ${h.hour}: ${h.pipeline} msgs, ${h.llm_errors} LLM errors, ${h.llm_fallbacks} fallbacks`)
    }
  }

  // Logs
  if (data.logs.length > 0) {
    sections.push('\n## Logs WARN/ERROR (deduplicados)')
    for (const log of data.logs) {
      sections.push(`- [${log.level.toUpperCase()}] [${log.component}] ${log.message} (×${log.count}, primera: ${log.first_seen}, última: ${log.last_seen})`)
    }
  }

  // Circuit breakers
  const openCbs = Object.entries(data.circuit_breakers).filter(([, v]) => v !== 'closed')
  if (openCbs.length > 0) {
    sections.push('\n## Circuit Breakers')
    for (const [name, state] of openCbs) {
      sections.push(`- ${name}: ${state}`)
    }
  }

  // Health snapshot
  if (data.health_snapshot) {
    const status = data.health_snapshot['status'] as string | undefined
    if (status) sections.push(`\n## Estado actual del sistema: ${status}`)
  }

  sections.push('\n## Schema de respuesta esperado')
  sections.push('Responde con JSON: { overall_health, summary, incidents: [{ what, impact, root_cause, immediate_fix, long_term_fix }], metrics_summary: { messages_processed, avg_latency_ms, error_rate, fallback_rate, uptime_percent }, recommendations: [] }')

  return sections.join('\n')
}

function parseResponse(text: string, data: PulseDataPackage): Omit<PulseReport, 'period' | 'period_start' | 'period_end'> {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>

    return {
      overall_health: validateHealth(parsed['overall_health']),
      summary: String(parsed['summary'] ?? 'Sin resumen'),
      incidents: Array.isArray(parsed['incidents'])
        ? (parsed['incidents'] as Array<Record<string, unknown>>).map((inc) => ({
            what: String(inc['what'] ?? ''),
            impact: String(inc['impact'] ?? ''),
            root_cause: String(inc['root_cause'] ?? ''),
            immediate_fix: String(inc['immediate_fix'] ?? ''),
            long_term_fix: String(inc['long_term_fix'] ?? ''),
          }))
        : [],
      metrics_summary: parseMetricsSummary(parsed['metrics_summary'], data),
      recommendations: Array.isArray(parsed['recommendations'])
        ? (parsed['recommendations'] as unknown[]).map(String)
        : [],
    }
  } catch (err) {
    logger.warn({ err, text: text.slice(0, 200) }, 'Failed to parse LLM response, using fallback')
    return {
      overall_health: 'degraded',
      summary: 'No se pudo parsear la respuesta del LLM. Revisar logs.',
      incidents: [],
      metrics_summary: buildMetricsSummary(data),
      recommendations: ['Verificar que el LLM esté respondiendo correctamente'],
    }
  }
}

function validateHealth(value: unknown): 'healthy' | 'degraded' | 'critical' {
  if (value === 'healthy' || value === 'degraded' || value === 'critical') return value
  return 'degraded'
}

function parseMetricsSummary(raw: unknown, data: PulseDataPackage): PulseMetricsSummary {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>
    return {
      messages_processed: Number(obj['messages_processed'] ?? 0),
      avg_latency_ms: Number(obj['avg_latency_ms'] ?? 0),
      error_rate: String(obj['error_rate'] ?? '0%'),
      fallback_rate: String(obj['fallback_rate'] ?? '0%'),
      uptime_percent: String(obj['uptime_percent'] ?? '100%'),
    }
  }
  return buildMetricsSummary(data)
}

function buildMetricsSummary(data: PulseDataPackage): PulseMetricsSummary {
  const totalMsgs = data.metrics.pipeline.count + data.metrics.hourly.pipeline
  const errorRate = totalMsgs > 0
    ? `${((data.metrics.pipeline.errors / totalMsgs) * 100).toFixed(1)}%`
    : '0%'
  const fallbackRate = data.metrics.llm.calls > 0
    ? `${((data.metrics.llm.fallbacks / data.metrics.llm.calls) * 100).toFixed(1)}%`
    : '0%'

  return {
    messages_processed: totalMsgs,
    avg_latency_ms: data.metrics.pipeline.latency_avg,
    error_rate: errorRate,
    fallback_rate: fallbackRate,
    uptime_percent: '99.9%',
  }
}
