# Luna Console — Guía de Diseño

## Filosofía
Estilo Apple: limpio, minimalista, mucho espacio en blanco, tipografía clara, bordes sutiles. Sin ruido visual.

## Paleta de colores

### Fondos
| Token             | Hex       | Uso                              |
|-------------------|-----------|----------------------------------|
| `--bg-primary`    | `#f5f5f7` | Fondo principal (Apple off-white)|
| `--bg-secondary`  | `#ffffff` | Paneles, cards, modales          |
| `--bg-tertiary`   | `#e8e8ed` | Hover states, separadores        |

### Textos
| Token             | Hex       | Uso                              |
|-------------------|-----------|----------------------------------|
| `--text-primary`  | `#1d1d1f` | Títulos, texto principal         |
| `--text-secondary`| `#6e6e73` | Subtítulos, labels, descripciones|
| `--text-tertiary` | `#86868b` | Placeholders, texto deshabilitado|

### Acentos (inspirados en el logo Fox)
| Token             | Hex       | Uso                              |
|-------------------|-----------|----------------------------------|
| `--accent`        | `#e8750a` | Botones primarios, links activos |
| `--accent-hover`  | `#c96209` | Hover en botones primarios       |
| `--accent-light`  | `#fff3e0` | Badge backgrounds, highlights    |
| `--accent-warm`   | `#f5a623` | Gradientes, iconos decorativos   |

### Bordes y sombras
| Token             | Hex / Valor                        | Uso                    |
|-------------------|------------------------------------|------------------------|
| `--border`        | `#d2d2d7`                          | Bordes de cards/inputs |
| `--border-light`  | `#e5e5ea`                          | Separadores sutiles    |
| `--shadow-sm`     | `0 1px 3px rgba(0,0,0,0.08)`      | Cards                  |
| `--shadow-md`     | `0 4px 12px rgba(0,0,0,0.1)`      | Modales, dropdowns     |

### Semánticos
| Token             | Hex       | Uso                              |
|-------------------|-----------|----------------------------------|
| `--success`       | `#34c759` | Estados OK, conexión activa      |
| `--warning`       | `#ff9500` | Alertas, estados intermedios     |
| `--error`         | `#ff3b30` | Errores, desconexión             |
| `--info`          | `#007aff` | Links, información               |

## Tipografía
- Font principal: `'Montserrat'` (Google Fonts) con fallback a `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`
- Monospace (inputs, código): `'SF Mono', 'Fira Code', monospace`
- Pesos: 400 (regular), 500 (medium), 600 (semibold), 700 (bold)
- Tamaños: 13px (small), 15px (body), 17px (subtitle), 22px (title), 28px (heading)
- Anti-aliasing: `-webkit-font-smoothing: antialiased`

## Header
- Formato: **Console | LUNA** — relevancia visual en "Console" (grande, bold), "LUNA" más pequeño en accent color
- Backdrop blur estilo Apple (frosted glass): `backdrop-filter: saturate(180%) blur(20px)`

## Bordes
- Radius cards/paneles: `12px`
- Radius botones: `8px`
- Radius inputs: `8px`
- Radius badges: `6px`

## Espaciado
- Padding cards: `20px`
- Gap entre paneles: `16px`
- Padding header: `16px 24px`

## Componentes

### Botones
- **Primario**: bg `--accent`, text `#ffffff`, hover `--accent-hover`, radius `8px`
- **Secundario**: bg `transparent`, border `--border`, text `--text-primary`, hover bg `--bg-tertiary`
- **Destructivo**: bg `--error`, text `#ffffff`

### Cards / Paneles
- bg `--bg-secondary`, border `1px solid --border`, radius `12px`, shadow `--shadow-sm`
- Header con font-weight 600, sin fondo diferenciado (solo separador inferior sutil)

### Inputs
- bg `--bg-secondary`, border `1px solid --border`, radius `8px`
- Focus: border `--accent`, outline none, shadow `0 0 0 3px rgba(232,117,10,0.15)`

### Status indicators
- Dot de 8px con color semántico + label en `--text-secondary`

## Responsive
- 100% responsive: funciona en desktop y móvil
- Breakpoints: 768px (tablet), 480px (phone)
- Mobile: fields pasan a 1 columna, padding reducido, build version oculto
- Header: reduce tamaño de brand en mobile
- Save bar: backdrop blur, se adapta a ancho

## Reglas
1. **NUNCA** usar `#000000` ni `#ffffff` puros — siempre los off-tones de Apple
2. Transiciones suaves: `all 0.2s ease`
3. Sin gradientes en fondos de layout — solo en elementos decorativos puntuales
4. Iconos: SVG inline, stroke-width 1.5, color hereda del texto
5. Hover states siempre visibles y sutiles
6. Backdrop blur (frosted glass) en header y save bar
7. Toggles estilo iOS (51x31px)
8. Inputs con fondo `--bg-primary` (gris sutil), focus cambia a blanco
