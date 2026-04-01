import { describe, it, expect } from 'vitest'
import { renderHitlSection } from '../../src/modules/hitl/render-section.js'

describe('renderHitlSection', () => {
  const defaultConfig: Record<string, string> = {}

  it('renders rules panel in Spanish', () => {
    const html = renderHitlSection(defaultConfig, 'es')
    expect(html).toContain('Reglas HITL')
    expect(html).toContain('hitl-rules-container')
    expect(html).toContain('Agregar regla')
  })

  it('renders rules panel in English', () => {
    const html = renderHitlSection(defaultConfig, 'en')
    expect(html).toContain('HITL Rules')
    expect(html).toContain('Add rule')
  })

  it('renders tickets panel', () => {
    const html = renderHitlSection(defaultConfig, 'es')
    expect(html).toContain('Tickets recientes')
    expect(html).toContain('hitl-tickets-container')
  })

  it('includes JavaScript for rules CRUD', () => {
    const html = renderHitlSection(defaultConfig, 'es')
    expect(html).toContain('hitlAddRule')
    expect(html).toContain('hitlToggleRule')
    expect(html).toContain('hitlDeleteRule')
    expect(html).toContain('/console/api/hitl')
  })

  it('includes client-side XSS escape function', () => {
    const html = renderHitlSection(defaultConfig, 'es')
    expect(html).toContain('function esc(s)')
    expect(html).toContain('&amp;')
    expect(html).toContain('&lt;')
  })
})
