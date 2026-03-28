// cortex/trace/render.ts — Console HTML section for Trace

import type { Pool } from 'pg'
import * as store from './store.js'
import { isRunActive } from './runner.js'

/**
 * Render the Trace dashboard section within Cortex console.
 */
export async function renderTraceSection(
  db: Pool,
  lang: 'es' | 'en',
  enabled: boolean,
): Promise<string> {
  const t = lang === 'es'
    ? {
        title: 'Trace — Simulador de Pipeline',
        disabled: 'Trace está desactivado',
        enable: 'Actívalo en la configuración de Cortex',
        scenarios: 'Escenarios',
        runs: 'Simulaciones recientes',
        noScenarios: 'No hay escenarios definidos',
        noRuns: 'No hay simulaciones',
        name: 'Nombre', messages: 'Mensajes', created: 'Creado',
        status: 'Estado', sims: 'Sims', tokens: 'Tokens', time: 'Tiempo',
        variant: 'Variante', score: 'Score', synthesis: 'Síntesis',
        running: 'Simulación en progreso...',
        newScenario: 'Nuevo escenario',
      }
    : {
        title: 'Trace — Pipeline Simulator',
        disabled: 'Trace is disabled',
        enable: 'Enable it in Cortex configuration',
        scenarios: 'Scenarios',
        runs: 'Recent Simulations',
        noScenarios: 'No scenarios defined',
        noRuns: 'No simulations',
        name: 'Name', messages: 'Messages', created: 'Created',
        status: 'Status', sims: 'Sims', tokens: 'Tokens', time: 'Time',
        variant: 'Variant', score: 'Score', synthesis: 'Synthesis',
        running: 'Simulation in progress...',
        newScenario: 'New scenario',
      }

  let html = `<div class="trace-section" style="margin-top:24px;border-top:1px solid var(--border);padding-top:16px;">`
  html += `<h2 style="margin:0 0 16px;display:flex;align-items:center;gap:8px;">&#129516; ${t.title}</h2>`

  if (!enabled) {
    html += `<div style="padding:16px;background:var(--bg-secondary);border-radius:8px;opacity:0.6;">`
    html += `<p>${t.disabled}. ${t.enable}.</p></div></div>`
    return html
  }

  // Active run indicator
  if (isRunActive()) {
    html += `<div style="padding:12px 16px;background:#2d4a1e;border-radius:8px;margin-bottom:16px;display:flex;align-items:center;gap:8px;">`
    html += `<span class="spinner" style="width:16px;height:16px;border:2px solid #4caf50;border-top-color:transparent;border-radius:50%;animation:spin 1s linear infinite;"></span>`
    html += `<span>${t.running}</span></div>`
  }

  // Scenarios list
  const scenarios = await store.listScenarios(db, 5)
  html += `<h3 style="margin:12px 0 8px">${t.scenarios} (${scenarios.length})</h3>`

  if (scenarios.length === 0) {
    html += `<p style="opacity:0.6">${t.noScenarios}</p>`
  } else {
    html += `<div style="display:flex;flex-direction:column;gap:4px;font-size:0.9em;">`
    for (const s of scenarios) {
      const msgCount = (s.config?.messages ?? []).length
      const date = new Date(s.created_at).toLocaleDateString()
      html += `<div style="padding:8px 12px;background:var(--bg-secondary);border-radius:6px;display:flex;justify-content:space-between;align-items:center;">`
      html += `<span><strong>${escHtml(s.name)}</strong> — ${msgCount} ${t.messages}</span>`
      html += `<span style="opacity:0.6;font-size:0.85em">${date}</span>`
      html += `</div>`
    }
    html += `</div>`
  }

  // Recent runs
  const runs = await store.listRuns(db, undefined, 5)
  html += `<h3 style="margin:16px 0 8px">${t.runs} (${runs.length})</h3>`

  if (runs.length === 0) {
    html += `<p style="opacity:0.6">${t.noRuns}</p>`
  } else {
    html += `<div style="display:flex;flex-direction:column;gap:4px;font-size:0.9em;">`
    for (const r of runs) {
      const statusIcon = statusToIcon(r.status)
      const dur = r.summary ? `${Math.round((r.summary as { duration_ms?: number }).duration_ms ?? 0) / 1000}s` : '—'
      const tokens = r.tokens_input + r.tokens_output

      html += `<div style="padding:8px 12px;background:var(--bg-secondary);border-radius:6px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:4px;">`
      html += `<span>${statusIcon} <strong>${r.variant_name}</strong> — ${r.sim_count} ${t.sims}</span>`
      html += `<span style="font-size:0.85em;opacity:0.7;">`
      html += `${t.tokens}: ${tokens.toLocaleString()} | ${t.time}: ${dur} | ${t.status}: ${r.status}`
      html += `</span></div>`

      // Show synthesis excerpt if available
      if (r.synthesis) {
        const excerpt = r.synthesis.substring(0, 200) + (r.synthesis.length > 200 ? '...' : '')
        html += `<div style="padding:6px 12px;margin-left:16px;border-left:2px solid var(--border);font-size:0.85em;opacity:0.8;">`
        html += `${escHtml(excerpt)}</div>`
      }
    }
    html += `</div>`
  }

  html += `</div>`
  html += `<style>@keyframes spin{to{transform:rotate(360deg)}}</style>`
  return html
}

function statusToIcon(status: string): string {
  switch (status) {
    case 'completed': return '&#9989;'  // ✅
    case 'running':   return '&#9889;'  // ⚡
    case 'analyzing': return '&#128300;' // 🔬
    case 'pending':   return '&#9203;'  // ⏳
    case 'failed':    return '&#10060;' // ❌
    case 'cancelled': return '&#128683;' // 🚫
    default:          return '&#10067;' // ❓
  }
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
