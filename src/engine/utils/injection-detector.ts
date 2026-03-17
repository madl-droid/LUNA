// LUNA Engine — Prompt Injection Detector
// Detección basada en regex. No usa LLM.

// Input injection patterns (user messages trying to manipulate the agent)
const INPUT_PATTERNS: RegExp[] = [
  /ignore\s+(previous|all|above|prior)\s+(instructions?|prompts?|rules?)/i,
  /you\s+are\s+(now|no\s+longer)\s+/i,
  /forget\s+(everything|all|your)\s+(instructions?|rules?|previous)/i,
  /new\s+instructions?:\s*/i,
  /system\s*prompt\s*[:=]/i,
  /\bDAN\b.*\bmode\b/i,
  /\bjailbreak\b/i,
  /act\s+as\s+(if\s+you\s+are|a)\s+/i,
  /pretend\s+(you\s+are|to\s+be)\s+/i,
  /reveal\s+(your|the)\s+(system|hidden|secret)\s+(prompt|instructions?)/i,
  /what\s+(are|is)\s+your\s+(system|hidden|secret)\s+(prompt|instructions?)/i,
  /override\s+(your|safety|the)\s+(instructions?|rules?|safet)/i,
  /\[system\]/i,
  /\[INST\]/i,
  /<\|im_start\|>/i,
  /<<\s*SYS\s*>>/i,
]

// Output injection patterns (check agent responses for leaks)
const OUTPUT_PATTERNS: RegExp[] = [
  /system\s*prompt/i,
  /guardrail/i,
  /identity\.md/i,
  /response-format\.md/i,
  /you\s+are\s+an?\s+AI\s+(assistant|language\s+model)/i,
  /as\s+an?\s+AI\s+(assistant|language\s+model),?\s+I/i,
  /my\s+(system\s+)?instructions\s+(say|tell|are)/i,
  /I('m|\s+am)\s+(just\s+)?an?\s+(AI|language\s+model|chatbot)/i,
]

// Sensitive data patterns (should never appear in output)
const SENSITIVE_PATTERNS: RegExp[] = [
  /sk-[a-zA-Z0-9]{20,}/,                           // OpenAI API key
  /sk-ant-[a-zA-Z0-9]{20,}/,                       // Anthropic API key
  /AIza[a-zA-Z0-9_-]{35}/,                         // Google API key
  /Bearer\s+[a-zA-Z0-9._-]{20,}/,                  // Bearer tokens
  /(?:password|secret|token)\s*[:=]\s*\S{8,}/i,    // Generic secrets
]

/**
 * Check input message for injection attempts.
 * Returns true if suspicious patterns detected.
 */
export function detectInputInjection(text: string): boolean {
  return INPUT_PATTERNS.some(pattern => pattern.test(text))
}

/**
 * Check output response for system prompt leaks or guardrail violations.
 * Returns list of issues found.
 */
export function detectOutputInjection(text: string): string[] {
  const issues: string[] = []

  for (const pattern of OUTPUT_PATTERNS) {
    if (pattern.test(text)) {
      issues.push(`Output leak pattern: ${pattern.source}`)
    }
  }

  return issues
}

/**
 * Check for sensitive data in output (API keys, tokens, etc).
 */
export function detectSensitiveData(text: string): string[] {
  const issues: string[] = []

  for (const pattern of SENSITIVE_PATTERNS) {
    if (pattern.test(text)) {
      issues.push(`Sensitive data pattern: ${pattern.source}`)
    }
  }

  return issues
}
