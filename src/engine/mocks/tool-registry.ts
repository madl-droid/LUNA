// LUNA Engine — Mock Tool Registry (S03)
// Simulates tool framework. Will be replaced by src/tools/ module.

import type { ToolResult, ToolCatalogEntry, ToolDefinition } from '../types.js'

// Mock tool catalog
const CATALOG: ToolCatalogEntry[] = [
  { name: 'schedule', description: 'Agendar cita o reunión en Google Calendar', category: 'calendar' },
  { name: 'lookup_product', description: 'Buscar producto/servicio en catálogo', category: 'catalog' },
  { name: 'lookup_contact', description: 'Buscar información de contacto existente', category: 'crm' },
  { name: 'update_contact', description: 'Actualizar datos de un contacto', category: 'crm' },
  { name: 'extract_qualification', description: 'Extraer datos de calificación BANT del mensaje', category: 'qualification' },
  { name: 'search', description: 'Buscar en base de datos o documentos', category: 'search' },
  { name: 'send_email', description: 'Enviar email al contacto o equipo', category: 'communication' },
  { name: 'create_reminder', description: 'Crear recordatorio para seguimiento', category: 'tasks' },
  { name: 'get_availability', description: 'Consultar disponibilidad en calendario', category: 'calendar' },
  { name: 'transfer_to_human', description: 'Escalar conversación a humano', category: 'escalation' },
]

const DEFINITIONS: Map<string, ToolDefinition> = new Map(
  CATALOG.map(t => [
    t.name,
    {
      name: t.name,
      description: t.description,
      parameters: { type: 'object', properties: {}, required: [] },
    },
  ]),
)

/**
 * Execute a tool by name with given params.
 * Mock: returns success with empty data for all tools.
 */
export async function executeTool(
  toolName: string,
  params: Record<string, unknown>,
): Promise<ToolResult> {
  const def = DEFINITIONS.get(toolName)
  if (!def) {
    return { success: false, error: `Tool "${toolName}" not found` }
  }

  // Mock responses per tool
  switch (toolName) {
    case 'lookup_product':
      return {
        success: true,
        data: {
          found: true,
          product: { name: 'Producto Demo', price: 100, currency: 'USD', available: true },
        },
      }
    case 'get_availability':
      return {
        success: true,
        data: {
          slots: [
            { date: '2026-03-18', time: '10:00', available: true },
            { date: '2026-03-18', time: '14:00', available: true },
            { date: '2026-03-19', time: '09:00', available: true },
          ],
        },
      }
    case 'extract_qualification':
      return {
        success: true,
        data: { extracted: true, fields: params },
      }
    case 'transfer_to_human':
      return {
        success: true,
        data: { transferred: true, assignedTo: 'equipo-ventas' },
      }
    default:
      return { success: true, data: { executed: true, tool: toolName, params } }
  }
}

/**
 * Get the full tool catalog.
 */
export function getCatalog(): ToolCatalogEntry[] {
  return [...CATALOG]
}

/**
 * Get a tool definition by name.
 */
export function getDefinition(toolName: string): ToolDefinition | null {
  return DEFINITIONS.get(toolName) ?? null
}
