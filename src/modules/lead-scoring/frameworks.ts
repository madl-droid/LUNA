// LUNA — Module: lead-scoring — Framework Presets
// Definiciones de CHAMP (B2B), SPIN (B2C), CHAMP+Gov (B2G).
// El admin elige un framework o usa 'custom' para config manual.

import type { FrameworkPreset, AutoSignalDefinition } from './types.js'

// ═══════════════════════════════════════════
// CHAMP — B2B (InsightSquared)
// ═══════════════════════════════════════════

export const CHAMP_PRESET: FrameworkPreset = {
  type: 'champ',
  name: { es: 'CHAMP (B2B)', en: 'CHAMP (B2B)' },
  description: {
    es: 'Framework B2B: Desafíos, Autoridad, Presupuesto, Priorización',
    en: 'B2B framework: Challenges, Authority, Money, Prioritization',
  },
  stages: [
    {
      key: 'challenges',
      name: { es: 'Desafíos', en: 'Challenges' },
      description: {
        es: '¿Qué problema o necesidad tiene la empresa?',
        en: 'What problem or need does the company have?',
      },
      order: 1,
    },
    {
      key: 'authority',
      name: { es: 'Autoridad', en: 'Authority' },
      description: {
        es: '¿Quién toma la decisión de compra?',
        en: 'Who makes the buying decision?',
      },
      order: 2,
    },
    {
      key: 'money',
      name: { es: 'Presupuesto', en: 'Money' },
      description: {
        es: '¿Tienen presupuesto asignado?',
        en: 'Do they have allocated budget?',
      },
      order: 3,
    },
    {
      key: 'prioritization',
      name: { es: 'Priorización', en: 'Prioritization' },
      description: {
        es: '¿Qué tan urgente es?',
        en: 'How urgent is it?',
      },
      order: 4,
    },
  ],
  criteria: [
    // --- Challenges ---
    {
      key: 'main_problem',
      name: { es: 'Problema principal', en: 'Main problem' },
      type: 'text',
      weight: 10,
      required: true,
      neverAskDirectly: false,
      stage: 'challenges',
    },
    {
      key: 'current_solution',
      name: { es: 'Qué usan actualmente', en: 'Current solution' },
      type: 'text',
      weight: 5,
      required: false,
      neverAskDirectly: false,
      stage: 'challenges',
    },
    {
      key: 'business_impact',
      name: { es: 'Impacto en su negocio', en: 'Business impact' },
      type: 'enum',
      options: ['low', 'medium', 'high', 'critical'],
      weight: 8,
      required: false,
      neverAskDirectly: false,
      stage: 'challenges',
    },
    {
      key: 'industry',
      name: { es: 'Industria / vertical', en: 'Industry / vertical' },
      type: 'text',
      weight: 5,
      required: false,
      neverAskDirectly: false,
      stage: 'challenges',
    },
    // --- Authority ---
    {
      key: 'contact_role',
      name: { es: 'Rol del contacto', en: 'Contact role' },
      type: 'enum',
      options: ['researcher', 'influencer', 'decision_maker'],
      weight: 12,
      required: false,
      neverAskDirectly: false,
      stage: 'authority',
    },
    {
      key: 'decision_maker_name',
      name: { es: 'Nombre del decisor', en: 'Decision maker name' },
      type: 'text',
      weight: 3,
      required: false,
      neverAskDirectly: false,
      stage: 'authority',
    },
    {
      key: 'approval_process',
      name: { es: 'Proceso de aprobación', en: 'Approval process' },
      type: 'enum',
      options: ['solo', 'committee', 'boss_approval'],
      weight: 5,
      required: false,
      neverAskDirectly: false,
      stage: 'authority',
    },
    {
      key: 'company_size',
      name: { es: 'Tamaño de empresa', en: 'Company size' },
      type: 'enum',
      options: ['micro', 'small', 'medium', 'large', 'enterprise'],
      weight: 5,
      required: false,
      neverAskDirectly: false,
      stage: 'authority',
    },
    // --- Money ---
    {
      key: 'budget_range',
      name: { es: 'Rango de presupuesto', en: 'Budget range' },
      type: 'text',
      weight: 10,
      required: false,
      neverAskDirectly: true,
      stage: 'money',
    },
    {
      key: 'budget_status',
      name: { es: 'Estado del presupuesto', en: 'Budget status' },
      type: 'enum',
      options: ['undefined', 'pending', 'approved'],
      weight: 8,
      required: false,
      neverAskDirectly: true,
      stage: 'money',
    },
    {
      key: 'purchase_model',
      name: { es: 'Modelo de compra', en: 'Purchase model' },
      type: 'enum',
      options: ['purchase', 'leasing', 'subscription'],
      weight: 3,
      required: false,
      neverAskDirectly: false,
      stage: 'money',
    },
    {
      key: 'scope_quantity',
      name: { es: 'Cantidad / alcance', en: 'Scope / quantity' },
      type: 'text',
      weight: 4,
      required: false,
      neverAskDirectly: false,
      stage: 'money',
    },
    // --- Prioritization ---
    {
      key: 'deadline',
      name: { es: 'Fecha límite o evento detonante', en: 'Deadline or trigger event' },
      type: 'text',
      weight: 7,
      required: false,
      neverAskDirectly: false,
      stage: 'prioritization',
    },
    {
      key: 'urgency',
      name: { es: 'Nivel de urgencia', en: 'Urgency level' },
      type: 'enum',
      options: ['low', 'medium', 'high'],
      weight: 8,
      required: false,
      neverAskDirectly: false,
      stage: 'prioritization',
    },
    {
      key: 'competitors_evaluated',
      name: { es: 'Competencia que evalúan', en: 'Competitors being evaluated' },
      type: 'text',
      weight: 3,
      required: false,
      neverAskDirectly: false,
      stage: 'prioritization',
    },
    {
      key: 'expected_next_step',
      name: { es: 'Siguiente paso esperado', en: 'Expected next step' },
      type: 'text',
      weight: 4,
      required: false,
      neverAskDirectly: false,
      stage: 'prioritization',
    },
  ],
  disqualifyReasons: [
    { key: 'no_budget', name: { es: 'Sin presupuesto', en: 'No budget' }, targetStatus: 'not_interested' },
    { key: 'not_interested', name: { es: 'No interesado', en: 'Not interested' }, targetStatus: 'not_interested' },
    { key: 'competitor_chosen', name: { es: 'Eligió competencia', en: 'Chose competitor' }, targetStatus: 'not_interested' },
    { key: 'spam', name: { es: 'Spam', en: 'Spam' }, targetStatus: 'blocked' },
    { key: 'out_of_zone', name: { es: 'Fuera de zona', en: 'Out of zone' }, targetStatus: 'out_of_zone' },
  ],
}

// ═══════════════════════════════════════════
// SPIN Selling adaptado — B2C (Neil Rackham)
// ═══════════════════════════════════════════

export const SPIN_PRESET: FrameworkPreset = {
  type: 'spin',
  name: { es: 'SPIN Selling (B2C)', en: 'SPIN Selling (B2C)' },
  description: {
    es: 'Framework B2C: Situación, Problema, Implicación, Cierre',
    en: 'B2C framework: Situation, Problem, Implication, Need-payoff',
  },
  stages: [
    {
      key: 'situation',
      name: { es: 'Situación', en: 'Situation' },
      description: {
        es: '¿Qué busca? ¿Cuál es su contexto?',
        en: 'What are they looking for? What is their context?',
      },
      order: 1,
    },
    {
      key: 'problem',
      name: { es: 'Problema', en: 'Problem' },
      description: {
        es: '¿Qué quiere resolver? ¿Qué le molesta?',
        en: 'What do they want to solve? What bothers them?',
      },
      order: 2,
    },
    {
      key: 'implication',
      name: { es: 'Implicación', en: 'Implication' },
      description: {
        es: '¿Qué tanto le afecta? ¿Qué pasa si no actúa?',
        en: 'How much does it affect them? What happens if they don\'t act?',
      },
      order: 3,
    },
    {
      key: 'need_payoff',
      name: { es: 'Cierre', en: 'Need-payoff' },
      description: {
        es: '¿Se ve usando la solución? ¿Quiere proceder?',
        en: 'Can they see themselves using the solution? Do they want to proceed?',
      },
      order: 4,
    },
  ],
  criteria: [
    // --- Situation ---
    {
      key: 'product_interest',
      name: { es: 'Producto o servicio de interés', en: 'Product/service of interest' },
      type: 'text',
      weight: 10,
      required: true,
      neverAskDirectly: false,
      stage: 'situation',
    },
    {
      key: 'prior_experience',
      name: { es: 'Experiencia previa', en: 'Prior experience' },
      type: 'enum',
      options: ['first_time', 'returning'],
      weight: 5,
      required: false,
      neverAskDirectly: false,
      stage: 'situation',
    },
    {
      key: 'current_solution',
      name: { es: 'Cómo lo resuelve actualmente', en: 'How they solve it now' },
      type: 'text',
      weight: 5,
      required: false,
      neverAskDirectly: false,
      stage: 'situation',
    },
    {
      key: 'lead_source',
      name: { es: 'Cómo llegó', en: 'How they arrived' },
      type: 'enum',
      options: ['campaign', 'referral', 'organic', 'social_media'],
      weight: 3,
      required: false,
      neverAskDirectly: false,
      stage: 'situation',
    },
    // --- Problem ---
    {
      key: 'main_pain',
      name: { es: 'Dolor o motivación principal', en: 'Main pain/motivation' },
      type: 'text',
      weight: 12,
      required: true,
      neverAskDirectly: false,
      stage: 'problem',
    },
    {
      key: 'problem_duration',
      name: { es: 'Hace cuánto tiene el problema', en: 'How long they\'ve had the problem' },
      type: 'text',
      weight: 5,
      required: false,
      neverAskDirectly: false,
      stage: 'problem',
    },
    {
      key: 'previous_attempts',
      name: { es: 'Qué ha intentado antes', en: 'What they\'ve tried before' },
      type: 'text',
      weight: 5,
      required: false,
      neverAskDirectly: false,
      stage: 'problem',
    },
    {
      key: 'dissatisfaction_level',
      name: { es: 'Nivel de insatisfacción', en: 'Dissatisfaction level' },
      type: 'enum',
      options: ['low', 'medium', 'high'],
      weight: 5,
      required: false,
      neverAskDirectly: false,
      stage: 'problem',
    },
    // --- Implication ---
    {
      key: 'impact',
      name: { es: 'Impacto emocional o práctico', en: 'Emotional/practical impact' },
      type: 'enum',
      options: ['low', 'medium', 'high'],
      weight: 8,
      required: false,
      neverAskDirectly: false,
      stage: 'implication',
    },
    {
      key: 'perceived_urgency',
      name: { es: 'Urgencia percibida', en: 'Perceived urgency' },
      type: 'enum',
      options: ['low', 'medium', 'high'],
      weight: 8,
      required: false,
      neverAskDirectly: false,
      stage: 'implication',
    },
    {
      key: 'trigger_event',
      name: { es: 'Evento detonante', en: 'Trigger event' },
      type: 'text',
      weight: 5,
      required: false,
      neverAskDirectly: false,
      stage: 'implication',
    },
    {
      key: 'willingness_to_invest',
      name: { es: 'Disposición a invertir', en: 'Willingness to invest' },
      type: 'enum',
      options: ['not_ready', 'considering', 'ready'],
      weight: 7,
      required: false,
      neverAskDirectly: true,
      stage: 'implication',
    },
    // --- Need-payoff ---
    {
      key: 'chosen_product',
      name: { es: 'Producto específico elegido', en: 'Specific product chosen' },
      type: 'text',
      weight: 7,
      required: false,
      neverAskDirectly: false,
      stage: 'need_payoff',
    },
    {
      key: 'explicit_interest',
      name: { es: 'Confirmación de interés', en: 'Interest confirmation' },
      type: 'boolean',
      weight: 7,
      required: false,
      neverAskDirectly: false,
      stage: 'need_payoff',
    },
    {
      key: 'preferred_schedule',
      name: { es: 'Preferencia de horario/fecha', en: 'Preferred schedule/date' },
      type: 'text',
      weight: 4,
      required: false,
      neverAskDirectly: false,
      stage: 'need_payoff',
    },
    {
      key: 'preferred_contact_method',
      name: { es: 'Método de contacto preferido', en: 'Preferred contact method' },
      type: 'text',
      weight: 4,
      required: false,
      neverAskDirectly: false,
      stage: 'need_payoff',
    },
  ],
  disqualifyReasons: [
    { key: 'not_interested', name: { es: 'No interesado', en: 'Not interested' }, targetStatus: 'not_interested' },
    { key: 'just_browsing', name: { es: 'Solo cotizando', en: 'Just browsing' }, targetStatus: 'cold' },
    { key: 'spam', name: { es: 'Spam', en: 'Spam' }, targetStatus: 'blocked' },
    { key: 'out_of_zone', name: { es: 'Fuera de zona', en: 'Out of zone' }, targetStatus: 'out_of_zone' },
  ],
}

// ═══════════════════════════════════════════
// CHAMP + Gov — B2G (Government)
// ═══════════════════════════════════════════

export const CHAMP_GOV_PRESET: FrameworkPreset = {
  type: 'champ_gov',
  name: { es: 'CHAMP + Gov (B2G)', en: 'CHAMP + Gov (B2G)' },
  description: {
    es: 'Framework B2G: CHAMP + Etapa del proceso + Encaje normativo',
    en: 'B2G framework: CHAMP + Process Stage + Compliance Fit',
  },
  stages: [
    {
      key: 'challenges',
      name: { es: 'Desafíos', en: 'Challenges' },
      description: {
        es: '¿Qué necesidad tiene la entidad?',
        en: 'What need does the entity have?',
      },
      order: 1,
    },
    {
      key: 'authority',
      name: { es: 'Autoridad', en: 'Authority' },
      description: {
        es: '¿Cuál es el rol del contacto en el proceso?',
        en: 'What is the contact\'s role in the process?',
      },
      order: 2,
    },
    {
      key: 'money',
      name: { es: 'Presupuesto', en: 'Money' },
      description: {
        es: '¿Hay rubro presupuestal asignado?',
        en: 'Is there allocated budget?',
      },
      order: 3,
    },
    {
      key: 'prioritization',
      name: { es: 'Priorización', en: 'Prioritization' },
      description: {
        es: '¿Qué tan prioritario es para la entidad?',
        en: 'How high-priority is it for the entity?',
      },
      order: 4,
    },
    {
      key: 'process_stage',
      name: { es: 'Etapa del proceso', en: 'Process Stage' },
      description: {
        es: '¿En qué fase de compra están?',
        en: 'What procurement phase are they in?',
      },
      order: 5,
    },
    {
      key: 'compliance_fit',
      name: { es: 'Encaje normativo', en: 'Compliance Fit' },
      description: {
        es: '¿El producto cumple los requisitos normativos?',
        en: 'Does the product meet regulatory requirements?',
      },
      order: 6,
    },
  ],
  criteria: [
    // --- Challenges ---
    {
      key: 'institutional_need',
      name: { es: 'Problema o necesidad institucional', en: 'Institutional need' },
      type: 'text',
      weight: 8,
      required: true,
      neverAskDirectly: false,
      stage: 'challenges',
    },
    {
      key: 'current_solution',
      name: { es: 'Qué usan actualmente', en: 'Current solution' },
      type: 'text',
      weight: 3,
      required: false,
      neverAskDirectly: false,
      stage: 'challenges',
    },
    {
      key: 'entity_type',
      name: { es: 'Tipo de entidad', en: 'Entity type' },
      type: 'enum',
      options: ['municipality', 'ministry', 'hospital', 'university', 'other'],
      weight: 4,
      required: false,
      neverAskDirectly: false,
      stage: 'challenges',
    },
    {
      key: 'department',
      name: { es: 'Área o dependencia', en: 'Department' },
      type: 'text',
      weight: 3,
      required: false,
      neverAskDirectly: false,
      stage: 'challenges',
    },
    // --- Authority ---
    {
      key: 'contact_role',
      name: { es: 'Rol del contacto', en: 'Contact role' },
      type: 'enum',
      options: ['technical', 'procurement', 'management', 'advisory'],
      weight: 7,
      required: false,
      neverAskDirectly: false,
      stage: 'authority',
    },
    {
      key: 'decision_area',
      name: { es: 'Área que lidera la decisión', en: 'Area leading the decision' },
      type: 'text',
      weight: 3,
      required: false,
      neverAskDirectly: false,
      stage: 'authority',
    },
    {
      key: 'approval_process',
      name: { es: 'Proceso de aprobación', en: 'Approval process' },
      type: 'enum',
      options: ['committee', 'director', 'secretary'],
      weight: 4,
      required: false,
      neverAskDirectly: false,
      stage: 'authority',
    },
    {
      key: 'can_influence_specs',
      name: { es: '¿Puede influir en especificaciones?', en: 'Can influence specs?' },
      type: 'boolean',
      weight: 4,
      required: false,
      neverAskDirectly: false,
      stage: 'authority',
    },
    // --- Money ---
    {
      key: 'budget_status',
      name: { es: 'Estado del presupuesto', en: 'Budget status' },
      type: 'enum',
      options: ['unassigned', 'pending', 'assigned', 'executed'],
      weight: 8,
      required: false,
      neverAskDirectly: true,
      stage: 'money',
    },
    {
      key: 'fiscal_year',
      name: { es: 'Año fiscal del rubro', en: 'Fiscal year' },
      type: 'text',
      weight: 3,
      required: false,
      neverAskDirectly: false,
      stage: 'money',
    },
    {
      key: 'budget_range',
      name: { es: 'Rango de inversión', en: 'Investment range' },
      type: 'text',
      weight: 5,
      required: false,
      neverAskDirectly: true,
      stage: 'money',
    },
    {
      key: 'funding_source',
      name: { es: 'Fuente de financiación', en: 'Funding source' },
      type: 'enum',
      options: ['own_budget', 'royalties', 'cooperation', 'other'],
      weight: 3,
      required: false,
      neverAskDirectly: false,
      stage: 'money',
    },
    // --- Prioritization ---
    {
      key: 'institutional_urgency',
      name: { es: 'Urgencia institucional', en: 'Institutional urgency' },
      type: 'enum',
      options: ['low', 'medium', 'high'],
      weight: 6,
      required: false,
      neverAskDirectly: false,
      stage: 'prioritization',
    },
    {
      key: 'deadline',
      name: { es: 'Fecha límite', en: 'Deadline' },
      type: 'text',
      weight: 5,
      required: false,
      neverAskDirectly: false,
      stage: 'prioritization',
    },
    {
      key: 'associated_project',
      name: { es: 'Proyecto o plan asociado', en: 'Associated project/plan' },
      type: 'text',
      weight: 3,
      required: false,
      neverAskDirectly: false,
      stage: 'prioritization',
    },
    {
      key: 'other_solutions',
      name: { es: 'Otras soluciones que evalúen', en: 'Other solutions being evaluated' },
      type: 'text',
      weight: 3,
      required: false,
      neverAskDirectly: false,
      stage: 'prioritization',
    },
    // --- Process Stage (B2G specific) ---
    {
      key: 'procurement_phase',
      name: { es: 'Fase de compra', en: 'Procurement phase' },
      type: 'enum',
      options: ['exploration', 'specification', 'formal_process', 'adjudication'],
      weight: 7,
      required: false,
      neverAskDirectly: false,
      stage: 'process_stage',
    },
    {
      key: 'procurement_type',
      name: { es: 'Tipo de proceso', en: 'Procurement type' },
      type: 'enum',
      options: ['minimum_amount', 'abbreviated_selection', 'public_tender'],
      weight: 4,
      required: false,
      neverAskDirectly: false,
      stage: 'process_stage',
    },
    {
      key: 'process_number',
      name: { es: 'Número de proceso', en: 'Process number' },
      type: 'text',
      weight: 3,
      required: false,
      neverAskDirectly: false,
      stage: 'process_stage',
    },
    {
      key: 'platform',
      name: { es: 'Plataforma de compras', en: 'Procurement platform' },
      type: 'text',
      weight: 1,
      required: false,
      neverAskDirectly: false,
      stage: 'process_stage',
    },
    // --- Compliance Fit (B2G specific) ---
    {
      key: 'required_certifications',
      name: { es: 'Certificaciones requeridas', en: 'Required certifications' },
      type: 'text',
      weight: 4,
      required: false,
      neverAskDirectly: false,
      stage: 'compliance_fit',
    },
    {
      key: 'vendor_requirements',
      name: { es: 'Requisitos de proveedor', en: 'Vendor requirements' },
      type: 'text',
      weight: 3,
      required: false,
      neverAskDirectly: false,
      stage: 'compliance_fit',
    },
    {
      key: 'technical_specs',
      name: { es: 'Especificaciones técnicas del pliego', en: 'Technical specs from terms' },
      type: 'text',
      weight: 3,
      required: false,
      neverAskDirectly: false,
      stage: 'compliance_fit',
    },
    {
      key: 'warranty_support',
      name: { es: 'Garantías o soporte exigido', en: 'Required warranty/support' },
      type: 'text',
      weight: 3,
      required: false,
      neverAskDirectly: false,
      stage: 'compliance_fit',
    },
  ],
  disqualifyReasons: [
    { key: 'no_budget', name: { es: 'Sin rubro presupuestal', en: 'No budget allocation' }, targetStatus: 'not_interested' },
    { key: 'not_interested', name: { es: 'No interesado', en: 'Not interested' }, targetStatus: 'not_interested' },
    { key: 'compliance_fail', name: { es: 'No cumple requisitos normativos', en: 'Does not meet compliance' }, targetStatus: 'not_interested' },
    { key: 'spam', name: { es: 'Spam', en: 'Spam' }, targetStatus: 'blocked' },
    { key: 'out_of_zone', name: { es: 'Fuera de zona', en: 'Out of zone' }, targetStatus: 'out_of_zone' },
  ],
}

// ═══════════════════════════════════════════
// Default Auto Signals (apply to all frameworks)
// ═══════════════════════════════════════════

export const DEFAULT_AUTO_SIGNALS: AutoSignalDefinition[] = [
  {
    key: 'engagement',
    name: { es: 'Engagement', en: 'Engagement' },
    description: {
      es: 'Velocidad de respuesta + cantidad de preguntas + longitud de mensajes',
      en: 'Response speed + question count + message length',
    },
    weight: 0,
    enabled: false,
  },
  {
    key: 'geo_fit',
    name: { es: 'Fit geográfico', en: 'Geographic fit' },
    description: {
      es: 'Ubicación vs zonas de cobertura',
      en: 'Location vs coverage zones',
    },
    weight: 0,
    enabled: false,
  },
  {
    key: 'channel_source',
    name: { es: 'Canal de origen', en: 'Channel source' },
    description: {
      es: 'Orgánico, campaña, referido, cold outbound',
      en: 'Organic, campaign, referral, cold outbound',
    },
    weight: 0,
    enabled: false,
  },
  {
    key: 'prior_history',
    name: { es: 'Historial previo', en: 'Prior history' },
    description: {
      es: '¿Ha interactuado antes? ¿Fue lead/cliente?',
      en: 'Has interacted before? Was a lead/client?',
    },
    weight: 0,
    enabled: false,
  },
  {
    key: 'contact_timing',
    name: { es: 'Horario de contacto', en: 'Contact timing' },
    description: {
      es: '¿Escribe en horario laboral o fuera?',
      en: 'Business hours or outside?',
    },
    weight: 0,
    enabled: false,
  },
]

// ═══════════════════════════════════════════
// Registry
// ═══════════════════════════════════════════

export const FRAMEWORK_PRESETS: Record<string, FrameworkPreset> = {
  champ: CHAMP_PRESET,
  spin: SPIN_PRESET,
  champ_gov: CHAMP_GOV_PRESET,
}

export function getFrameworkPreset(type: string): FrameworkPreset | undefined {
  return FRAMEWORK_PRESETS[type]
}
