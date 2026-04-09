// LUNA — Module: lead-scoring — Framework Presets (v3)
// Single-preset config: CHAMP (B2B), SPIN (B2C), CHAMP+Gov (B2G).
// Each preset max 10 criteria. Priority replaces weight.

import type { FrameworkObjective, FrameworkStage, QualifyingCriterion, DisqualifyReason } from './types.js'

// ═══════════════════════════════════════════
// Preset definition
// ═══════════════════════════════════════════

export interface PresetDefinition {
  key: string                                 // 'champ', 'spin', 'champ_gov'
  name: { es: string; en: string }
  description: { es: string; en: string }
  defaultObjective: FrameworkObjective
  stages: FrameworkStage[]
  criteria: QualifyingCriterion[]             // uses priority instead of weight
  disqualifyReasons: DisqualifyReason[]
  essentialQuestions: string[]
}

// ═══════════════════════════════════════════
// CHAMP — B2B (InsightSquared) — 10 criteria
// ═══════════════════════════════════════════

export const CHAMP_PRESET: PresetDefinition = {
  key: 'champ',
  name: { es: 'CHAMP (B2B)', en: 'CHAMP (B2B)' },
  description: {
    es: 'Framework B2B: Desafíos, Autoridad, Presupuesto, Priorización',
    en: 'B2B framework: Challenges, Authority, Money, Prioritization',
  },
  defaultObjective: 'schedule',
  essentialQuestions: ['main_problem', 'contact_role'],
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
      priority: 'high',
      required: true,
      neverAskDirectly: false,
      stage: 'challenges',
    },
    {
      key: 'current_solution',
      name: { es: 'Qué usan actualmente', en: 'Current solution' },
      type: 'text',
      priority: 'medium',
      required: false,
      neverAskDirectly: false,
      stage: 'challenges',
    },
    {
      key: 'business_impact',
      name: { es: 'Impacto en su negocio', en: 'Business impact' },
      type: 'enum',
      options: ['low', 'medium', 'high', 'critical'],
      priority: 'high',
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
      priority: 'high',
      required: false,
      neverAskDirectly: false,
      stage: 'authority',
    },
    {
      key: 'approval_process',
      name: { es: 'Proceso de aprobación', en: 'Approval process' },
      type: 'enum',
      options: ['solo', 'committee', 'boss_approval'],
      priority: 'medium',
      required: false,
      neverAskDirectly: false,
      stage: 'authority',
    },
    {
      key: 'company_size',
      name: { es: 'Tamaño de empresa', en: 'Company size' },
      type: 'enum',
      options: ['micro', 'small', 'medium', 'large', 'enterprise'],
      priority: 'medium',
      required: false,
      neverAskDirectly: false,
      stage: 'authority',
    },
    // --- Money ---
    {
      key: 'budget_range',
      name: { es: 'Rango de presupuesto', en: 'Budget range' },
      type: 'text',
      priority: 'high',
      required: false,
      neverAskDirectly: true,
      stage: 'money',
    },
    {
      key: 'budget_status',
      name: { es: 'Estado del presupuesto', en: 'Budget status' },
      type: 'enum',
      options: ['undefined', 'pending', 'approved'],
      priority: 'high',
      required: false,
      neverAskDirectly: true,
      stage: 'money',
    },
    // --- Prioritization ---
    {
      key: 'deadline',
      name: { es: 'Fecha límite o evento detonante', en: 'Deadline or trigger event' },
      type: 'text',
      priority: 'medium',
      required: false,
      neverAskDirectly: false,
      stage: 'prioritization',
    },
    {
      key: 'urgency',
      name: { es: 'Nivel de urgencia', en: 'Urgency level' },
      type: 'enum',
      options: ['low', 'medium', 'high'],
      priority: 'high',
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
// SPIN Selling — B2C (Neil Rackham) — 10 criteria
// ═══════════════════════════════════════════

export const SPIN_PRESET: PresetDefinition = {
  key: 'spin',
  name: { es: 'SPIN Selling (B2C)', en: 'SPIN Selling (B2C)' },
  description: {
    es: 'Framework B2C: Situación, Problema, Implicación, Cierre',
    en: 'B2C framework: Situation, Problem, Implication, Need-payoff',
  },
  defaultObjective: 'schedule',
  essentialQuestions: ['product_interest', 'main_pain'],
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
        en: "How much does it affect them? What happens if they don't act?",
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
      priority: 'high',
      required: true,
      neverAskDirectly: false,
      stage: 'situation',
    },
    {
      key: 'prior_experience',
      name: { es: 'Experiencia previa', en: 'Prior experience' },
      type: 'enum',
      options: ['first_time', 'returning'],
      priority: 'medium',
      enumScoring: 'presence',
      required: false,
      neverAskDirectly: false,
      stage: 'situation',
    },
    // --- Problem ---
    {
      key: 'main_pain',
      name: { es: 'Dolor o motivación principal', en: 'Main pain/motivation' },
      type: 'text',
      priority: 'high',
      required: true,
      neverAskDirectly: false,
      stage: 'problem',
    },
    {
      key: 'dissatisfaction_level',
      name: { es: 'Nivel de insatisfacción', en: 'Dissatisfaction level' },
      type: 'enum',
      options: ['low', 'medium', 'high'],
      priority: 'medium',
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
      priority: 'high',
      required: false,
      neverAskDirectly: false,
      stage: 'implication',
    },
    {
      key: 'perceived_urgency',
      name: { es: 'Urgencia percibida', en: 'Perceived urgency' },
      type: 'enum',
      options: ['low', 'medium', 'high'],
      priority: 'high',
      required: false,
      neverAskDirectly: false,
      stage: 'implication',
    },
    {
      key: 'trigger_event',
      name: { es: 'Evento detonante', en: 'Trigger event' },
      type: 'text',
      priority: 'medium',
      required: false,
      neverAskDirectly: false,
      stage: 'implication',
    },
    {
      key: 'willingness_to_invest',
      name: { es: 'Disposición a invertir', en: 'Willingness to invest' },
      type: 'enum',
      options: ['not_ready', 'considering', 'ready'],
      priority: 'medium',
      required: false,
      neverAskDirectly: true,
      stage: 'implication',
    },
    // --- Need-payoff ---
    {
      key: 'chosen_product',
      name: { es: 'Producto específico elegido', en: 'Specific product chosen' },
      type: 'text',
      priority: 'medium',
      required: false,
      neverAskDirectly: false,
      stage: 'need_payoff',
    },
    {
      key: 'explicit_interest',
      name: { es: 'Confirmación de interés', en: 'Interest confirmation' },
      type: 'boolean',
      priority: 'medium',
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
// CHAMP + Gov — B2G (Government) — 10 criteria
// ═══════════════════════════════════════════

export const CHAMP_GOV_PRESET: PresetDefinition = {
  key: 'champ_gov',
  name: { es: 'CHAMP + Gov (B2G)', en: 'CHAMP + Gov (B2G)' },
  description: {
    es: 'Framework B2G: CHAMP + Etapa del proceso + Encaje normativo',
    en: 'B2G framework: CHAMP + Process Stage + Compliance Fit',
  },
  defaultObjective: 'schedule',
  essentialQuestions: ['institutional_need', 'contact_role'],
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
        en: "What is the contact's role in the process?",
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
      priority: 'high',
      required: true,
      neverAskDirectly: false,
      stage: 'challenges',
    },
    {
      key: 'entity_type',
      name: { es: 'Tipo de entidad', en: 'Entity type' },
      type: 'enum',
      options: ['municipality', 'ministry', 'hospital', 'university', 'other'],
      priority: 'medium',
      enumScoring: 'presence',
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
      priority: 'high',
      required: false,
      neverAskDirectly: false,
      stage: 'authority',
    },
    {
      key: 'approval_process',
      name: { es: 'Proceso de aprobación', en: 'Approval process' },
      type: 'enum',
      options: ['committee', 'director', 'secretary'],
      priority: 'medium',
      required: false,
      neverAskDirectly: false,
      stage: 'authority',
    },
    {
      key: 'can_influence_specs',
      name: { es: '¿Puede influir en especificaciones?', en: 'Can influence specs?' },
      type: 'boolean',
      priority: 'medium',
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
      priority: 'high',
      required: false,
      neverAskDirectly: true,
      stage: 'money',
    },
    {
      key: 'budget_range',
      name: { es: 'Rango de inversión', en: 'Investment range' },
      type: 'text',
      priority: 'medium',
      required: false,
      neverAskDirectly: true,
      stage: 'money',
    },
    // --- Prioritization ---
    {
      key: 'institutional_urgency',
      name: { es: 'Urgencia institucional', en: 'Institutional urgency' },
      type: 'enum',
      options: ['low', 'medium', 'high'],
      priority: 'medium',
      required: false,
      neverAskDirectly: false,
      stage: 'prioritization',
    },
    {
      key: 'deadline',
      name: { es: 'Fecha límite', en: 'Deadline' },
      type: 'text',
      priority: 'medium',
      required: false,
      neverAskDirectly: false,
      stage: 'prioritization',
    },
    // --- Process Stage ---
    {
      key: 'procurement_phase',
      name: { es: 'Fase de compra', en: 'Procurement phase' },
      type: 'enum',
      options: ['exploration', 'specification', 'formal_process', 'adjudication'],
      priority: 'high',
      required: false,
      neverAskDirectly: false,
      stage: 'process_stage',
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
// Registry
// ═══════════════════════════════════════════

export const PRESETS: Record<string, PresetDefinition> = {
  champ: CHAMP_PRESET,
  spin: SPIN_PRESET,
  champ_gov: CHAMP_GOV_PRESET,
}

export function getPreset(key: string): PresetDefinition | undefined {
  return PRESETS[key]
}
