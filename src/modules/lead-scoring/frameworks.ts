// LUNA — Module: lead-scoring — Framework Presets (v3)
// Single-preset config: CHAMP (B2B), SPIN (B2C), CHAMP+Gov (B2G).
// Each preset max 30 criteria. Priority replaces weight.

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
// CHAMP — B2B (InsightSquared)
// ═══════════════════════════════════════════

export const CHAMP_PRESET: PresetDefinition = {
  key: 'champ',
  name: { es: 'CHAMP (B2B)', en: 'CHAMP (B2B)' },
  description: {
    es: 'Framework B2B: Desafíos, Autoridad, Presupuesto, Priorización',
    en: 'B2B framework: Challenges, Authority, Money, Prioritization',
  },
  defaultObjective: 'schedule',
  essentialQuestions: ['problema_principal', 'rol_contacto'],
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
        es: '¿Qué tan urgente es resolver esto?',
        en: 'How urgent is it to solve this?',
      },
      order: 4,
    },
  ],
  criteria: [
    // --- Challenges ---
    {
      key: 'problema_principal',
      name: { es: 'Problema principal', en: 'Main problem' },
      type: 'text',
      priority: 'high',
      required: true,
      neverAskDirectly: false,
      stage: 'challenges',
    },
    {
      key: 'solucion_actual',
      name: { es: 'Solución actual', en: 'Current solution' },
      type: 'text',
      priority: 'medium',
      required: false,
      neverAskDirectly: false,
      stage: 'challenges',
    },
    {
      key: 'impacto_negocio',
      name: { es: 'Impacto en el negocio', en: 'Business impact' },
      type: 'enum',
      options: ['Bajo', 'Medio', 'Alto', 'Crítico'],
      enumScoring: 'indexed',
      priority: 'high',
      required: false,
      neverAskDirectly: false,
      stage: 'challenges',
    },
    // --- Authority ---
    {
      key: 'rol_contacto',
      name: { es: 'Rol del contacto', en: 'Contact role' },
      type: 'enum',
      options: ['Investigador', 'Influenciador', 'Tomador de decisión'],
      enumScoring: 'indexed',
      priority: 'high',
      required: false,
      neverAskDirectly: false,
      stage: 'authority',
    },
    {
      key: 'proceso_aprobacion',
      name: { es: 'Proceso de aprobación', en: 'Approval process' },
      type: 'enum',
      options: ['Decisión individual', 'Aprobación de directivo', 'Comité'],
      enumScoring: 'indexed',
      priority: 'medium',
      required: false,
      neverAskDirectly: false,
      stage: 'authority',
    },
    {
      key: 'tamano_empresa',
      name: { es: 'Tamaño de empresa', en: 'Company size' },
      type: 'enum',
      options: ['Micro', 'Pequeña', 'Mediana', 'Grande', 'Corporativo'],
      enumScoring: 'presence',
      priority: 'medium',
      required: false,
      neverAskDirectly: false,
      stage: 'authority',
    },
    // --- Money ---
    {
      key: 'estado_presupuesto',
      name: { es: 'Estado del presupuesto', en: 'Budget status' },
      type: 'enum',
      options: ['Sin definir', 'En proceso', 'Aprobado'],
      enumScoring: 'indexed',
      priority: 'high',
      required: false,
      neverAskDirectly: true,
      stage: 'money',
    },
    {
      key: 'rango_inversion',
      name: { es: 'Rango de inversión', en: 'Investment range' },
      type: 'text',
      priority: 'medium',
      required: false,
      neverAskDirectly: true,
      stage: 'money',
    },
    // --- Prioritization ---
    {
      key: 'urgencia',
      name: { es: 'Urgencia', en: 'Urgency' },
      type: 'enum',
      options: ['Baja', 'Media', 'Alta'],
      enumScoring: 'indexed',
      priority: 'high',
      required: false,
      neverAskDirectly: false,
      stage: 'prioritization',
    },
    {
      key: 'plazo_decision',
      name: { es: 'Plazo de decisión', en: 'Decision timeline' },
      type: 'text',
      priority: 'medium',
      required: false,
      neverAskDirectly: false,
      stage: 'prioritization',
    },
  ],
  disqualifyReasons: [
    { key: 'sin_presupuesto', name: { es: 'Sin presupuesto', en: 'No budget' }, targetStatus: 'not_interested' },
    { key: 'no_interesado', name: { es: 'No interesado', en: 'Not interested' }, targetStatus: 'not_interested' },
    { key: 'eligio_competencia', name: { es: 'Eligió competencia', en: 'Chose competitor' }, targetStatus: 'not_interested' },
    { key: 'spam', name: { es: 'Spam', en: 'Spam' }, targetStatus: 'blocked' },
    { key: 'fuera_de_zona', name: { es: 'Fuera de zona', en: 'Out of zone' }, targetStatus: 'out_of_zone' },
  ],
}

// ═══════════════════════════════════════════
// SPIN Selling — B2C (Neil Rackham)
// ═══════════════════════════════════════════

export const SPIN_PRESET: PresetDefinition = {
  key: 'spin',
  name: { es: 'SPIN Selling (B2C)', en: 'SPIN Selling (B2C)' },
  description: {
    es: 'Framework B2C: Situación, Problema, Implicación, Cierre',
    en: 'B2C framework: Situation, Problem, Implication, Need-payoff',
  },
  defaultObjective: 'schedule',
  essentialQuestions: ['producto_interes', 'motivacion_principal'],
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
      key: 'producto_interes',
      name: { es: 'Producto o servicio de interés', en: 'Product/service of interest' },
      type: 'text',
      priority: 'high',
      required: true,
      neverAskDirectly: false,
      stage: 'situation',
    },
    {
      key: 'experiencia_previa',
      name: { es: 'Experiencia previa', en: 'Prior experience' },
      type: 'enum',
      options: ['Primera vez', 'Cliente recurrente'],
      enumScoring: 'presence',
      priority: 'medium',
      required: false,
      neverAskDirectly: false,
      stage: 'situation',
    },
    // --- Problem ---
    {
      key: 'motivacion_principal',
      name: { es: 'Motivación o dolor principal', en: 'Main pain/motivation' },
      type: 'text',
      priority: 'high',
      required: true,
      neverAskDirectly: false,
      stage: 'problem',
    },
    {
      key: 'nivel_insatisfaccion',
      name: { es: 'Nivel de insatisfacción actual', en: 'Dissatisfaction level' },
      type: 'enum',
      options: ['Bajo', 'Medio', 'Alto'],
      enumScoring: 'indexed',
      priority: 'medium',
      required: false,
      neverAskDirectly: false,
      stage: 'problem',
    },
    // --- Implication ---
    {
      key: 'impacto',
      name: { es: 'Impacto emocional o práctico', en: 'Emotional/practical impact' },
      type: 'enum',
      options: ['Bajo', 'Medio', 'Alto'],
      enumScoring: 'indexed',
      priority: 'high',
      required: false,
      neverAskDirectly: false,
      stage: 'implication',
    },
    {
      key: 'urgencia_percibida',
      name: { es: 'Urgencia percibida', en: 'Perceived urgency' },
      type: 'enum',
      options: ['Sin urgencia', 'Pronto', 'Urgente'],
      enumScoring: 'indexed',
      priority: 'high',
      required: false,
      neverAskDirectly: false,
      stage: 'implication',
    },
    {
      key: 'evento_detonante',
      name: { es: 'Evento detonante', en: 'Trigger event' },
      type: 'text',
      priority: 'medium',
      required: false,
      neverAskDirectly: false,
      stage: 'implication',
    },
    {
      key: 'disposicion_invertir',
      name: { es: 'Disposición a invertir', en: 'Willingness to invest' },
      type: 'enum',
      options: ['No listo', 'Considerando', 'Listo para comprar'],
      enumScoring: 'indexed',
      priority: 'medium',
      required: false,
      neverAskDirectly: true,
      stage: 'implication',
    },
    // --- Need-payoff ---
    {
      key: 'producto_especifico',
      name: { es: 'Producto específico elegido', en: 'Specific product chosen' },
      type: 'text',
      priority: 'medium',
      required: false,
      neverAskDirectly: false,
      stage: 'need_payoff',
    },
    {
      key: 'confirmacion_interes',
      name: { es: 'Confirmó interés explícitamente', en: 'Confirmed interest explicitly' },
      type: 'boolean',
      priority: 'medium',
      required: false,
      neverAskDirectly: false,
      stage: 'need_payoff',
    },
  ],
  disqualifyReasons: [
    { key: 'no_interesado', name: { es: 'No interesado', en: 'Not interested' }, targetStatus: 'not_interested' },
    { key: 'solo_cotizando', name: { es: 'Solo cotizando', en: 'Just browsing' }, targetStatus: 'cold' },
    { key: 'spam', name: { es: 'Spam', en: 'Spam' }, targetStatus: 'blocked' },
    { key: 'fuera_de_zona', name: { es: 'Fuera de zona', en: 'Out of zone' }, targetStatus: 'out_of_zone' },
  ],
}

// ═══════════════════════════════════════════
// CHAMP + Gov — B2G (Government)
// ═══════════════════════════════════════════

export const CHAMP_GOV_PRESET: PresetDefinition = {
  key: 'champ_gov',
  name: { es: 'CHAMP + Gov (B2G)', en: 'CHAMP + Gov (B2G)' },
  description: {
    es: 'Framework B2G: CHAMP + Etapa del proceso + Encaje normativo',
    en: 'B2G framework: CHAMP + Process Stage + Compliance Fit',
  },
  defaultObjective: 'schedule',
  essentialQuestions: ['necesidad_institucional', 'rol_contacto'],
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
      key: 'necesidad_institucional',
      name: { es: 'Necesidad institucional', en: 'Institutional need' },
      type: 'text',
      priority: 'high',
      required: true,
      neverAskDirectly: false,
      stage: 'challenges',
    },
    {
      key: 'tipo_entidad',
      name: { es: 'Tipo de entidad', en: 'Entity type' },
      type: 'enum',
      options: ['Municipio', 'Ministerio', 'Hospital', 'Universidad', 'Empresa pública', 'Otro'],
      enumScoring: 'presence',
      priority: 'medium',
      required: false,
      neverAskDirectly: false,
      stage: 'challenges',
    },
    // --- Authority ---
    {
      key: 'rol_contacto',
      name: { es: 'Rol del contacto', en: 'Contact role' },
      type: 'enum',
      options: ['Técnico', 'Contratación', 'Directivo', 'Asesor'],
      enumScoring: 'indexed',
      priority: 'high',
      required: false,
      neverAskDirectly: false,
      stage: 'authority',
    },
    {
      key: 'proceso_aprobacion',
      name: { es: 'Proceso de aprobación', en: 'Approval process' },
      type: 'enum',
      options: ['Comité', 'Director', 'Secretario o Ministro'],
      enumScoring: 'indexed',
      priority: 'medium',
      required: false,
      neverAskDirectly: false,
      stage: 'authority',
    },
    {
      key: 'puede_influir_specs',
      name: { es: '¿Puede influir en especificaciones?', en: 'Can influence specs?' },
      type: 'boolean',
      priority: 'medium',
      required: false,
      neverAskDirectly: false,
      stage: 'authority',
    },
    // --- Money ---
    {
      key: 'estado_presupuesto',
      name: { es: 'Estado del presupuesto', en: 'Budget status' },
      type: 'enum',
      options: ['Sin rubro', 'En proceso de asignación', 'Asignado', 'Ejecutado'],
      enumScoring: 'indexed',
      priority: 'high',
      required: false,
      neverAskDirectly: true,
      stage: 'money',
    },
    {
      key: 'rango_inversion',
      name: { es: 'Rango de inversión', en: 'Investment range' },
      type: 'text',
      priority: 'medium',
      required: false,
      neverAskDirectly: true,
      stage: 'money',
    },
    // --- Prioritization ---
    {
      key: 'urgencia_institucional',
      name: { es: 'Urgencia institucional', en: 'Institutional urgency' },
      type: 'enum',
      options: ['Baja', 'Media', 'Alta'],
      enumScoring: 'indexed',
      priority: 'medium',
      required: false,
      neverAskDirectly: false,
      stage: 'prioritization',
    },
    {
      key: 'plazo_limite',
      name: { es: 'Fecha límite', en: 'Deadline' },
      type: 'text',
      priority: 'medium',
      required: false,
      neverAskDirectly: false,
      stage: 'prioritization',
    },
    // --- Process Stage ---
    {
      key: 'fase_compra',
      name: { es: 'Fase de compra', en: 'Procurement phase' },
      type: 'enum',
      options: ['Exploración', 'Especificación', 'Proceso formal', 'Adjudicación'],
      enumScoring: 'indexed',
      priority: 'high',
      required: false,
      neverAskDirectly: false,
      stage: 'process_stage',
    },
    // --- Compliance Fit ---
    {
      key: 'cumplimiento_normativo',
      name: { es: 'Encaje normativo', en: 'Compliance fit' },
      type: 'enum',
      options: ['No evaluado', 'Parcial', 'Cumple'],
      enumScoring: 'indexed',
      priority: 'high',
      required: false,
      neverAskDirectly: false,
      stage: 'compliance_fit',
    },
  ],
  disqualifyReasons: [
    { key: 'sin_rubro', name: { es: 'Sin rubro presupuestal', en: 'No budget allocation' }, targetStatus: 'not_interested' },
    { key: 'no_interesado', name: { es: 'No interesado', en: 'Not interested' }, targetStatus: 'not_interested' },
    { key: 'no_cumple_normativa', name: { es: 'No cumple requisitos normativos', en: 'Does not meet compliance' }, targetStatus: 'not_interested' },
    { key: 'spam', name: { es: 'Spam', en: 'Spam' }, targetStatus: 'blocked' },
    { key: 'fuera_de_zona', name: { es: 'Fuera de zona', en: 'Out of zone' }, targetStatus: 'out_of_zone' },
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
