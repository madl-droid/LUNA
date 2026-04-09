### DATOS DEL LEAD: {{displayName}}

---
### INFORMACIÓN DE CALIFICACIÓN (BANT):
{{qualificationData}}

---
### RESUMEN DEL HISTORIAL:
{{historyStr}}

---
### INSTRUCCIÓN DE EVALUACIÓN:
Procesa los datos anteriores bajo la metodología definida. Genera un análisis técnico de propensión de compra y devuelve estrictamente un objeto JSON con esta estructura:

{
  "score": [Número del 0 al 100],
  "reason": "[Explicación concisa de la puntuación en español]",
  "recommend_reactivation": [true/false]
}

**Responde exclusivamente en formato JSON.**
