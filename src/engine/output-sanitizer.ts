import type { ValidationResult } from './types.js'
import { detectOutputInjection, detectSensitiveData } from './utils/injection-detector.js'

const TOOL_CALL_PATTERNS: RegExp[] = [
  /\[TOOL_CALL:\s*[^\]]+\](\s*\{[\s\S]*?\})?/g,
  /<function_calls>[\s\S]*?<\/function_calls>/g,
  /```(?:json|xml|tool)?\s*\n?\s*\{[\s\S]*?"tool"[\s\S]*?\}\s*```/g,
  /\{"type"\s*:\s*"tool_use"[\s\S]*?\}/g,
]

function detectToolCallLeakage(text: string): string[] {
  const issues: string[] = []
  for (const pattern of TOOL_CALL_PATTERNS) {
    if (pattern.test(text)) {
      issues.push('tool_call_leakage: response contains tool invocation syntax')
      break
    }
    pattern.lastIndex = 0
  }
  return issues
}

function sanitizeToolCallLeakage(text: string): string {
  let sanitized = text
  for (const pattern of TOOL_CALL_PATTERNS) {
    pattern.lastIndex = 0
    sanitized = sanitized.replace(pattern, '')
  }
  return sanitized.replace(/\n{3,}/g, '\n\n').trim()
}

export function validateOutput(text: string): ValidationResult {
  const issues: string[] = []
  issues.push(...detectOutputInjection(text))
  issues.push(...detectSensitiveData(text))
  const toolCallIssues = detectToolCallLeakage(text)
  issues.push(...toolCallIssues)

  if (issues.length === 0) {
    return { passed: true, issues: [], sanitizedText: text }
  }

  let sanitized = text
  if (toolCallIssues.length > 0) {
    sanitized = sanitizeToolCallLeakage(sanitized)
  }
  sanitized = sanitized.replace(/sk-ant-[a-zA-Z0-9]{20,}/g, '[REDACTED]')
  sanitized = sanitized.replace(/AIza[a-zA-Z0-9_-]{35}/g, '[REDACTED]')
  sanitized = sanitized.replace(/Bearer\s+[a-zA-Z0-9._-]{20,}/g, 'Bearer [REDACTED]')
  sanitized = sanitized.replace(/(?:password|secret|token)\s*[:=]\s*\S{8,}/gi, (match) => {
    const prefix = match.match(/^(?:password|secret|token)\s*[:=]\s*/i)?.[0] ?? ''
    return `${prefix}[REDACTED]`
  })

  return { passed: false, issues, sanitizedText: sanitized }
}

export function sanitizeParts(parts: string[]): { parts: string[]; issues: string[] } {
  const issues = new Set<string>()
  const sanitized = parts.map((part) => {
    const validation = validateOutput(part)
    if (!validation.passed) {
      for (const issue of validation.issues) issues.add(issue)
      return validation.sanitizedText
    }
    return part
  })

  return { parts: sanitized, issues: [...issues] }
}
