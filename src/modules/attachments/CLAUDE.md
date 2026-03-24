# Attachments — Procesamiento de adjuntos cross-channel

Modulo feature que procesa adjuntos (PDF, Word, Excel, imagenes) y genera resumenes de texto. Disponible para todos los canales via servicio del registry.

## Archivos
- `manifest.ts` — lifecycle, configSchema, console fields
- `types.ts` — AttachmentInput, ProcessedAttachment, AttachmentProcessor, AttachmentConfig
- `processor.ts` — logica de extraccion: pdf-parse, mammoth, xlsx, LLM vision para imagenes

## Manifest
- type: `feature`, removable: true, activateByDefault: true
- depends: `['llm']` (necesita LLM para describir imagenes)
- configSchema: ATTACHMENT_MAX_SIZE_MB, ATTACHMENT_PROCESS_IMAGES, ATTACHMENT_PROCESS_PDFS, ATTACHMENT_PROCESS_DOCUMENTS, ATTACHMENT_PROCESS_SPREADSHEETS, ATTACHMENT_SUMMARY_MAX_TOKENS

## Servicio registrado
- `attachments:processor` — instancia de AttachmentProcessor

## Uso desde otros canales
```typescript
const processor = registry.getOptional<AttachmentProcessor>('attachments:processor')
if (processor && attachments.length > 0) {
  const inputs = attachments.map(att => ({
    filename: att.filename,
    mimeType: att.mimeType,
    size: att.size,
    getData: () => downloadAttachment(att.id),
  }))
  const processed = await processor.process(inputs)
  const summary = processed.filter(p => p.summary).map(p => p.summary).join('\n')
}
```

## Tipos soportados
- PDF: pdf-parse
- Word (.docx): mammoth
- Excel (.xlsx, .xls), CSV: xlsx
- Imagenes (PNG, JPG, WebP, GIF): LLM vision via `llm:chat` hook

## Trampas
- Las librerias pdf-parse, mammoth, xlsx ya son dependencias del proyecto (usadas por knowledge)
- Imagenes requieren LLM con soporte de vision — si falla, se retorna placeholder
- El getData() es lazy: solo descarga cuando el procesador lo necesita
- Adjuntos que exceden ATTACHMENT_MAX_SIZE_MB se reportan sin procesar
