import { describe, it, expect } from 'vitest'
import { renderHitlSection } from '../../src/modules/hitl/render-section.js'

describe('renderHitlSection', () => {
  const defaultConfig: Record<string, string> = {
    HITL_ENABLED: 'true',
    HITL_DEFAULT_CHANNEL: 'auto',
    HITL_TICKET_TTL_HOURS: '24',
    HITL_FOLLOWUP_INTERVAL_MIN: '30',
    HITL_MAX_FOLLOWUPS: '3',
    HITL_AUTO_EXPIRE_NOTIFY: 'true',
  }

  it('renders panel with correct title in Spanish', () => {
    const html = renderHitlSection(defaultConfig, 'es')
    expect(html).toContain('Human-in-the-Loop (HITL)')
    expect(html).toContain('panel')
    expect(html).toContain('HITL_ENABLED')
  })

  it('renders panel with English info', () => {
    const html = renderHitlSection(defaultConfig, 'en')
    expect(html).toContain('Human consultation and escalation system')
  })

  it('renders enabled checkbox as checked when true', () => {
    const html = renderHitlSection({ ...defaultConfig, HITL_ENABLED: 'true' }, 'es')
    expect(html).toContain('checked')
  })

  it('renders enabled checkbox unchecked when false', () => {
    const html = renderHitlSection({ ...defaultConfig, HITL_ENABLED: 'false' }, 'es')
    // The toggle should NOT have 'checked' for HITL_ENABLED
    const enabledSection = html.split('HITL_ENABLED')[1]!.split('HITL_DEFAULT_CHANNEL')[0]!
    expect(enabledSection).not.toContain('checked')
  })

  it('renders all config fields', () => {
    const html = renderHitlSection(defaultConfig, 'es')
    expect(html).toContain('HITL_ENABLED')
    expect(html).toContain('HITL_DEFAULT_CHANNEL')
    expect(html).toContain('HITL_TICKET_TTL_HOURS')
    expect(html).toContain('HITL_FOLLOWUP_INTERVAL_MIN')
    expect(html).toContain('HITL_MAX_FOLLOWUPS')
    expect(html).toContain('HITL_AUTO_EXPIRE_NOTIFY')
  })

  it('renders channel select with all options', () => {
    const html = renderHitlSection(defaultConfig, 'es')
    expect(html).toContain('WhatsApp')
    expect(html).toContain('Email')
    expect(html).toContain('Google Chat')
    expect(html).toContain('Automatico')
  })

  it('selects correct channel from config', () => {
    const html = renderHitlSection({ ...defaultConfig, HITL_DEFAULT_CHANNEL: 'whatsapp' }, 'es')
    expect(html).toContain('value="whatsapp" selected')
  })

  it('uses default values when config is empty', () => {
    const html = renderHitlSection({}, 'es')
    expect(html).toContain('value="24"')  // default TTL
    expect(html).toContain('value="30"')  // default follow-up interval
    expect(html).toContain('value="3"')   // default max follow-ups
  })

  it('escapes HTML in config values', () => {
    const html = renderHitlSection({
      ...defaultConfig,
      HITL_TICKET_TTL_HOURS: '<script>alert("xss")</script>',
    }, 'es')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })
})
