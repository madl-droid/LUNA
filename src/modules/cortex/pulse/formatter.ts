// cortex/pulse/formatter.ts — Format Pulse reports for admin channels
// Short messages for WhatsApp/Telegram, full reports stay in DB/dashboard.

import type { PulseReport, PulseReportMode } from '../types.js'

const HEALTH_ICONS: Record<string, string> = {
  healthy: '🟢',
  degraded: '🟡',
  critical: '🔴',
}

/**
 * Format a Pulse report as a short notification message.
 * Used for batch/sync delivery to admin channels.
 */
export function formatNotification(report: PulseReport, mode: PulseReportMode): string {
  const icon = HEALTH_ICONS[report.overall_health] ?? '⚪'
  const lines: string[] = []

  if (mode === 'immediate') {
    lines.push(`${icon} PULSE — [ANÁLISIS URGENTE]`)
  } else if (mode === 'batch') {
    lines.push(`${icon} PULSE — Reporte diario`)
  } else {
    lines.push(`${icon} PULSE — Reporte periódico`)
  }

  lines.push(`Estado general: ${report.overall_health.toUpperCase()}`)
  lines.push('')

  // Incidents
  if (report.incidents.length > 0) {
    lines.push(`${report.incidents.length} incidente${report.incidents.length > 1 ? 's' : ''} detectado${report.incidents.length > 1 ? 's' : ''}:`)
    const maxShow = mode === 'immediate' ? report.incidents.length : 3
    for (let i = 0; i < Math.min(report.incidents.length, maxShow); i++) {
      const inc = report.incidents[i]!
      lines.push(`${i + 1}. ${inc.what}`)
    }
    if (report.incidents.length > maxShow) {
      lines.push(`   ... y ${report.incidents.length - maxShow} más`)
    }
  } else {
    lines.push('0 incidentes.')
  }

  // Metrics one-liner
  const m = report.metrics_summary
  lines.push('')
  lines.push(`${m.messages_processed} msgs | ${m.avg_latency_ms}ms avg | ${m.error_rate} errores | ${m.fallback_rate} fallback`)

  // Top recommendations (max 2 for notifications, all for immediate)
  if (report.recommendations.length > 0) {
    lines.push('')
    lines.push('Recomendaciones:')
    const maxRec = mode === 'immediate' ? report.recommendations.length : 2
    for (let i = 0; i < Math.min(report.recommendations.length, maxRec); i++) {
      lines.push(`• ${report.recommendations[i]}`)
    }
  }

  // Immediate mode: include root causes
  if (mode === 'immediate' && report.incidents.length > 0) {
    lines.push('')
    lines.push('Diagnóstico:')
    for (const inc of report.incidents) {
      lines.push(`• ${inc.what}`)
      lines.push(`  Causa: ${inc.root_cause}`)
      lines.push(`  Acción: ${inc.immediate_fix}`)
    }
  }

  if (mode !== 'immediate') {
    lines.push('')
    lines.push('Reporte completo en dashboard.')
  }

  return lines.join('\n')
}

/**
 * Format a simple "all healthy" message (no LLM call needed).
 */
export function formatQuietNotification(messagesProcessed: number): string {
  return `🟢 PULSE — Sistema saludable\n${messagesProcessed} mensajes procesados, 0 incidentes.`
}
