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

  // ─── Step 3: Agent Persona ───────────────
  agent_title: { es: 'Personalidad del Agente', en: 'Agent Persona' },
  agent_text: {
    es: 'Define la identidad de tu agente de IA. Nombre, cargo, idioma y acento que usar\u00e1 al comunicarse.',
    en: 'Define your AI agent\'s identity. Name, role, language and accent it will use when communicating.',
  },
  agent_name: { es: 'Nombre del agente', en: 'Agent first name' },
  agent_last_name: { es: 'Apellido', en: 'Last name' },
  agent_role: { es: 'Cargo / Rol', en: 'Title / Role' },
  agent_role_placeholder: { es: 'Ej: Ejecutiva de ventas', en: 'E.g.: Sales Executive' },
  agent_role_hint: { es: 'C\u00f3mo se presenta el agente ante los leads.', en: 'How the agent introduces itself to leads.' },
  agent_language: { es: 'Idioma principal', en: 'Primary language' },
  agent_language_hint: { es: 'Idioma por defecto para respuestas y mensajes del sistema.', en: 'Default language for responses and system messages.' },
  agent_accent: { es: 'Acento / Regionalismo', en: 'Accent / Regionalism' },
  agent_accent_warning: {
    es: 'Configurar un acento hace que el agente use expresiones y modismos regionales. Esto puede afectar su capacidad de comunicarse de forma natural en otros idiomas. Si tus leads hablan varios idiomas, considera dejar el acento vac\u00edo.',
    en: 'Setting an accent makes the agent use regional expressions and idioms. This may affect its ability to communicate naturally in other languages. If your leads speak multiple languages, consider leaving the accent empty.',
  },
  agent_no_accent: { es: 'Sin acento', en: 'No accent' },
  err_agent_name_required: { es: 'El nombre del agente es requerido', en: 'Agent name is required' },

  // ─── Step 4: API Keys ───────────────────
  api_title: { es: 'Claves de API', en: 'API Keys' },
  api_text: {
    es: 'Ingresa las API keys de los proveedores de IA. Necesitas al menos una. Anthropic (Claude) es el proveedor principal; Google (Gemini) se usa como fallback.',
    en: 'Enter the AI provider API keys. You need at least one. Anthropic (Claude) is the primary provider; Google (Gemini) is used as fallback.',
  },
  llm_anthropic_key: { es: 'API Key de Anthropic', en: 'Anthropic API Key' },
  llm_google_key: { es: 'API Key de Google AI', en: 'Google AI API Key' },
  api_anthropic_hint: { es: 'Proveedor principal (Claude). Obt\u00e9n tu key en console.anthropic.com', en: 'Primary provider (Claude). Get your key at console.anthropic.com' },
  api_google_hint: { es: 'Proveedor de fallback (Gemini). Obt\u00e9n tu key en aistudio.google.com', en: 'Fallback provider (Gemini). Get your key at aistudio.google.com' },
  err_no_api_key: { es: 'Debes ingresar al menos una API key', en: 'You must enter at least one API key' },

  // ─── Step 5: Company + summary ───────────
  system_title: { es: 'Tu Empresa', en: 'Your Company' },
  system_text: {
    es: 'Ingresa el nombre de tu empresa y revisa el resumen antes de finalizar.',
    en: 'Enter your company name and review the summary before finishing.',
  },
  company_name: { es: 'Nombre de la empresa', en: 'Company name' },
  company_name_placeholder: { es: 'Ej: Acme Corp', en: 'E.g.: Acme Corp' },
  company_name_hint: {
    es: 'El agente sabr\u00e1 que trabaja para esta empresa y se presentar\u00e1 como parte de ella.',
    en: 'The agent will know it works for this company and introduce itself as part of it.',
  },
  err_company_name_required: { es: 'El nombre de la empresa es requerido', en: 'Company name is required' },
  summary_title: { es: 'Resumen de configuraci\u00f3n', en: 'Configuration summary' },
  summary_admin: { es: 'Administrador', en: 'Admin' },
  summary_agent: { es: 'Agente', en: 'Agent' },
  summary_company: { es: 'Empresa', en: 'Company' },
  summary_agent_lang: { es: 'Idioma del agente', en: 'Agent language' },
  summary_agent_accent: { es: 'Acento', en: 'Accent' },
  summary_masked: { es: '(configurada)', en: '(configured)' },

  // ─── Complete ────────────────────────────
  setup_complete_title: { es: '\u00a1Instalaci\u00f3n completa!', en: 'Setup complete!' },
  setup_complete_text: {
    es: 'Tu instancia de LUNA est\u00e1 lista. Ser\u00e1s redirigido al panel de control.',
    en: 'Your LUNA instance is ready. You will be redirected to the control panel.',
  },
  setup_defaults_title: { es: 'Configuraci\u00f3n por defecto', en: 'Default settings' },
  setup_defaults_messages: {
    es: 'Por defecto, los mensajes de contactos nuevos se ignoran. Solo se responde a administradores.',
    en: 'By default, messages from new contacts are ignored. Only admins get responses.',
  },
  setup_defaults_change: {
    es: 'Para cambiar esto, ve a Contactos \u2192 Configuraci\u00f3n en la consola:',
    en: 'To change this, go to Contacts \u2192 Settings in the console:',
  },
  setup_defaults_link: { es: 'Configuraci\u00f3n de contactos', en: 'Contact settings' },
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
