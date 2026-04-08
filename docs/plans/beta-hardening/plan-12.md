# Plan 12 — UI / Console Fixes

**Prioridad:** MEDIUM
**Objetivo:** Corregir bugs visuales y funcionales en el panel de administracion que afectan la experiencia del operador.

## Archivos target

| Archivo | Scope |
|---------|-------|
| `src/modules/console/templates-section-channels.ts` | Google Apps cards toggle + settings button |

## Paso 0 — Verificacion obligatoria

1. Leer `src/modules/console/templates-section-channels.ts` completo — confirmar la funcion `renderGoogleAppsSection()` y el script inline JS
2. Verificar que `gwsServiceToggled()` solo cambia opacidad (linea 250) sin tocar el boton Configurar ni la clase inactive
3. Verificar que `settingsBtn` se renderiza server-side solo si `isActive` en linea 204

## FIX-01: Google Calendar card — boton "Configurar" no aparece dinamicamente [MAIN]
**Archivo:** `src/modules/console/templates-section-channels.ts` ~lineas 204-252
**Bug:** El boton "Configurar" para Google Calendar se renderiza server-side en linea 204 con la condicion `hasSettings && isActive`. Pero cuando el usuario toglea Calendar OFF y luego ON via JS, `gwsServiceToggled()` (linea 247-252) solo cambia la opacidad de la card — NO crea/muestra el boton Configurar dinamicamente. Ademas, no toglea la clase `ts-gws-card-inactive`.

**Escenarios del bug:**
1. Calendar activo al cargar pagina → boton visible. User toglea OFF → boton desaparece (opacidad baja pero el boton sigue en DOM). User toglea ON → boton sigue visible. **ESTE CASO FUNCIONA** (el boton nunca se remueve del DOM).
2. Calendar INactivo al cargar pagina → boton NO existe en el HTML. User toglea ON → boton NO aparece (porque nunca fue renderizado). **ESTE CASO FALLA**.
3. Independientemente del caso, la clase `ts-gws-card-inactive` nunca se toglea desde JS, solo se aplica en el render inicial.

**Fix completo de `gwsServiceToggled()`:**

```javascript
window.gwsServiceToggled = function(checkbox) {
  var serviceId = checkbox.dataset.service;
  var card = checkbox.closest('.gws-card');
  if (!card) return;
  
  var isChecked = checkbox.checked;
  
  // Toggle inactive class (was only opacity before)
  if (isChecked) {
    card.classList.remove('ts-gws-card-inactive');
    card.style.opacity = '1';
  } else {
    card.classList.add('ts-gws-card-inactive');
    card.style.opacity = '0.6';
  }
  
  // Show/hide settings button dynamically
  // Services with settings: calendar
  var settingsServices = { calendar: true };
  if (settingsServices[serviceId]) {
    var header = card.querySelector('.ts-gws-card-header > div:last-child');
    if (!header) { gwsSaveServices(); return; }
    
    var existingBtn = header.querySelector('a.btn-secondary');
    if (isChecked && !existingBtn) {
      // Create the Configurar button
      var btn = document.createElement('a');
      btn.href = '/console/herramientas/google-apps/' + serviceId;
      btn.className = 'btn-secondary';
      btn.style.cssText = 'font-size:12px;padding:4px 10px;margin-left:8px;text-decoration:none';
      btn.textContent = document.documentElement.lang === 'en' ? 'Configure' : 'Configurar';
      btn.onclick = function(e) { e.stopPropagation(); };
      header.insertBefore(btn, header.firstChild);
    } else if (!isChecked && existingBtn) {
      existingBtn.remove();
    }
  }
  
  gwsSaveServices();
};
```

**Pasos concretos:**
1. Leer el bloque `<script>` completo en `renderGoogleAppsSection()` (~lineas 239-280)
2. Reemplazar la funcion `gwsServiceToggled` con la version que:
   a. Toglea `ts-gws-card-inactive` class (no solo opacidad)
   b. Crea el boton "Configurar" dinamicamente al activar Calendar (si no existe)
   c. Remueve el boton al desactivar Calendar (si existe)
3. Detectar idioma para el texto del boton: usar `document.documentElement.lang` o inferir del HTML existente. El SSR ya setea el lang del documento, o como alternativa, leer el texto de otro boton existente en la pagina.

**Alternativa mas simple (menos JS):**
En vez de crear/remover el boton, renderizar el boton SIEMPRE en el HTML y controlarlo con CSS:
1. Cambiar linea 204-206: siempre generar el boton HTML, pero agregar `style="display:none"` si no esta activo:
   ```typescript
   const settingsBtn = (svc as { hasSettings?: boolean }).hasSettings
     ? `<a href="/console/herramientas/google-apps/${svc.id}" class="btn-secondary gws-settings-btn" data-service="${svc.id}" style="font-size:12px;padding:4px 10px;margin-left:8px;text-decoration:none${!isActive ? ';display:none' : ''}" onclick="event.stopPropagation()">${isEs ? 'Configurar' : 'Configure'}</a>`
     : ''
   ```
2. En `gwsServiceToggled()`, agregar:
   ```javascript
   var settingsBtn = card.querySelector('.gws-settings-btn');
   if (settingsBtn) settingsBtn.style.display = isChecked ? '' : 'none';
   ```

**PREFERIR la alternativa simple** — menos JS, menos riesgo de bugs.

**Verificacion:**
1. Cargar pagina con Calendar INactivo → boton no visible
2. Activar Calendar via toggle → boton "Configurar" aparece
3. Click en "Configurar" → navega a `/console/herramientas/google-apps/calendar`
4. Desactivar Calendar → boton desaparece
5. La card se marca con clase `ts-gws-card-inactive` al desactivar

## Verificacion post-fix

1. Compilar: `npx tsc --noEmit` — 0 errores nuevos (el script es string inline, no TS)
2. Verificar visualmente en browser:
   - Abrir `/console/herramientas/google-apps`
   - Calendar activo → boton "Configurar" visible junto al toggle
   - Desactivar Calendar → boton desaparece, card se marca inactive
   - Reactivar Calendar → boton reaparece
   - Click en "Configurar" → pagina de configuracion de Calendar se carga correctamente

## Notas

- Este plan tiene un solo fix pero es autocontenido. Se puede combinar con otro plan si hay mas bugs de UI confirmados
- El archivo `templates-section-channels.ts` NO colisiona con ningun otro plan activo
- El fix es puramente client-side JS (dentro de un template string) — no afecta SSR, API, ni logica de negocio
