// LUNA — Setup wizard & login: i18n strings
// Minimal bilingual dictionary (ES/EN) for wizard and login pages.

export type SetupLang = 'es' | 'en'

const dict: Record<string, Record<SetupLang, string>> = {
  // ─── General ──────────────────────────────
  app_name: { es: 'LUNA', en: 'LUNA' },
  app_subtitle: { es: 'Agente IA de Leads', en: 'AI Lead Agent' },
  next: { es: 'Siguiente', en: 'Next' },
  back: { es: 'Atr\u00e1s', en: 'Back' },
  finish: { es: 'Finalizar instalaci\u00f3n', en: 'Finish Setup' },
  required: { es: 'Requerido', en: 'Required' },
  step_of: { es: 'Paso {n} de {total}', en: 'Step {n} of {total}' },

  // ─── Step 1: Welcome ─────────────────────
  welcome_title: { es: 'Bienvenido a LUNA', en: 'Welcome to LUNA' },
  welcome_text: {
    es: 'Este asistente te guiar\u00e1 para configurar tu instancia de LUNA. En pocos pasos tendr\u00e1s tu agente de IA atendiendo leads por WhatsApp, email y m\u00e1s.',
    en: 'This wizard will guide you through setting up your LUNA instance. In a few steps you\'ll have your AI agent handling leads via WhatsApp, email and more.',
  },
  select_language: { es: 'Selecciona tu idioma', en: 'Select your language' },
  lang_es: { es: 'Espa\u00f1ol', en: 'Spanish' },
  lang_en: { es: 'Ingl\u00e9s', en: 'English' },

  // ─── Step 2: Admin account ───────────────
  admin_title: { es: 'Cuenta de Administrador', en: 'Admin Account' },
  admin_text: {
    es: 'Crea la cuenta del super administrador. Esta persona tendr\u00e1 acceso total al sistema.',
    en: 'Create the super admin account. This person will have full system access.',
  },
  admin_name: { es: 'Nombre completo', en: 'Full name' },
  admin_email: { es: 'Correo electr\u00f3nico', en: 'Email address' },
  admin_phone: { es: 'Tel\u00e9fono (opcional, con +prefijo)', en: 'Phone (optional, with +prefix)' },
  admin_password: { es: 'Contrase\u00f1a', en: 'Password' },
  admin_password_confirm: { es: 'Confirmar contrase\u00f1a', en: 'Confirm password' },

  // ─── Step 2: Validation ──────────────────
  err_name_required: { es: 'El nombre es requerido', en: 'Name is required' },
  err_email_required: { es: 'El correo es requerido', en: 'Email is required' },
  err_email_invalid: { es: 'Correo electr\u00f3nico inv\u00e1lido', en: 'Invalid email address' },
  err_phone_invalid: { es: 'Tel\u00e9fono debe comenzar con + seguido de d\u00edgitos', en: 'Phone must start with + followed by digits' },
  err_password_required: { es: 'La contrase\u00f1a es requerida', en: 'Password is required' },
  err_password_min: { es: 'La contrase\u00f1a debe tener al menos 8 caracteres', en: 'Password must be at least 8 characters' },
  err_password_mismatch: { es: 'Las contrase\u00f1as no coinciden', en: 'Passwords do not match' },

  // ─── Step 3: LLM Configuration ──────────
  llm_title: { es: 'Configuraci\u00f3n de IA', en: 'AI Configuration' },
  llm_text: {
    es: 'Configura los proveedores de IA que LUNA usar\u00e1 para procesar mensajes. Necesitas al menos una API key.',
    en: 'Configure the AI providers LUNA will use to process messages. You need at least one API key.',
  },
  llm_processing_provider: { es: 'Proveedor para procesamiento (clasificar, herramientas, comprimir)', en: 'Processing provider (classify, tools, compress)' },
  llm_interaction_provider: { es: 'Proveedor para interacci\u00f3n (responder, complejo, proactivo)', en: 'Interaction provider (respond, complex, proactive)' },
  llm_anthropic: { es: 'Anthropic (Claude)', en: 'Anthropic (Claude)' },
  llm_google: { es: 'Google (Gemini)', en: 'Google (Gemini)' },
  llm_anthropic_key: { es: 'API Key de Anthropic', en: 'Anthropic API Key' },
  llm_google_key: { es: 'API Key de Google AI', en: 'Google AI API Key' },
  err_anthropic_key_required: { es: 'Se requiere API Key de Anthropic (seleccionado como proveedor)', en: 'Anthropic API Key required (selected as provider)' },
  err_google_key_required: { es: 'Se requiere API Key de Google AI (seleccionado como proveedor)', en: 'Google AI API Key required (selected as provider)' },
  err_no_provider: { es: 'Debes seleccionar al menos un proveedor de IA', en: 'You must select at least one AI provider' },
  llm_test_connection: { es: 'Probar conexi\u00f3n', en: 'Test connection' },

  // ─── Step 4: System settings ─────────────
  system_title: { es: 'Ajustes del Sistema', en: 'System Settings' },
  system_text: {
    es: 'Configura los ajustes finales de tu instancia.',
    en: 'Configure the final settings for your instance.',
  },
  instance_name: { es: 'Nombre de la instancia', en: 'Instance name' },
  instance_name_placeholder: { es: 'Ej: Mi Empresa', en: 'E.g.: My Company' },
  log_level: { es: 'Nivel de log', en: 'Log level' },
  node_env: { es: 'Entorno', en: 'Environment' },
  node_env_development: { es: 'Desarrollo', en: 'Development' },
  node_env_production: { es: 'Producci\u00f3n', en: 'Production' },
  summary_title: { es: 'Resumen de configuraci\u00f3n', en: 'Configuration summary' },
  summary_admin: { es: 'Administrador', en: 'Admin' },
  summary_llm: { es: 'Proveedor IA', en: 'AI Provider' },
  summary_processing: { es: 'Procesamiento', en: 'Processing' },
  summary_interaction: { es: 'Interacci\u00f3n', en: 'Interaction' },
  summary_masked: { es: '(configurada)', en: '(configured)' },

  // ─── Step 4: Complete ────────────────────
  setup_complete_title: { es: '\u00a1Instalaci\u00f3n completa!', en: 'Setup complete!' },
  setup_complete_text: {
    es: 'Tu instancia de LUNA est\u00e1 lista. Ser\u00e1s redirigido al panel de control.',
    en: 'Your LUNA instance is ready. You will be redirected to the control panel.',
  },
  go_to_console: { es: 'Ir al panel', en: 'Go to console' },

  // ─── Login page ──────────────────────────
  login_title: { es: 'Iniciar sesi\u00f3n', en: 'Sign in' },
  login_email: { es: 'Correo electr\u00f3nico', en: 'Email' },
  login_password: { es: 'Contrase\u00f1a', en: 'Password' },
  login_submit: { es: 'Entrar', en: 'Sign in' },
  login_error: { es: 'Credenciales inv\u00e1lidas', en: 'Invalid credentials' },
  login_session_expired: { es: 'Tu sesi\u00f3n ha expirado, inicia sesi\u00f3n nuevamente', en: 'Your session has expired, please sign in again' },
  logout_success: { es: 'Sesi\u00f3n cerrada correctamente', en: 'Logged out successfully' },

  // ─── Factory reset ───────────────────────
  reset_confirm_title: { es: 'Confirmar reset de f\u00e1brica', en: 'Confirm factory reset' },
  reset_confirm_text: {
    es: 'Esto reiniciar\u00e1 la configuraci\u00f3n del sistema. Ingresa tu contrase\u00f1a para confirmar.',
    en: 'This will reset the system configuration. Enter your password to confirm.',
  },
  reset_password: { es: 'Contrase\u00f1a del administrador', en: 'Admin password' },
  reset_confirm_btn: { es: 'Confirmar reset', en: 'Confirm reset' },
  reset_error: { es: 'Contrase\u00f1a incorrecta', en: 'Incorrect password' },
}

/** Translate a key for the given language. Supports {n} and {total} placeholders. */
export function st(key: string, lang: SetupLang, vars?: Record<string, string | number>): string {
  const entry = dict[key]
  if (!entry) return key
  let text = entry[lang] ?? entry['es'] ?? key
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      text = text.replaceAll(`{${k}}`, String(v))
    }
  }
  return text
}

/** Detect language from cookie header. */
export function detectSetupLang(cookieHeader: string | undefined): SetupLang {
  if (!cookieHeader) return 'es'
  const match = cookieHeader.match(/luna[-_]lang=(\w+)/)
  return match?.[1] === 'en' ? 'en' : 'es'
}
