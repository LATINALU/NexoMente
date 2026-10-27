<p align="center"><img src="frontend/public/favicon.svg" width="88" alt="NexoMente"></p>

<h1 align="center">NexoMente</h1>
<p align="center"><b>Equipos de agentes IA con memoria: investigan, leen tus notas y documentos, y responden juntos.</b></p>

NexoMente une dos proyectos:

- **[Nexo](https://github.com/LATINALU/Nexo)**: equipos de agentes IA que trabajan **en paralelo** con streaming, consultan
  tus documentos y la web, y un **Coordinador** integra todo con **fuentes citadas**.
- **[Neuromapa](https://github.com/lumiel777/neuromapa)** (en `neuromapa/`): tu memoria como un **cerebro 3D en vivo**,
  con un buscador de notas, un médico que avisa datos viejos y aprendizaje por uso.

Juntos: los agentes **consultan tus notas** (la memoria de Claude Code, tus `CLAUDE.md` y las carpetas que sumes) y las
citan como **[N1]**; mientras trabajan, el **🧠 Cerebro** muestra en vivo qué nota lee cada agente.

- **500 agentes** en **50 categorías**, definidos como datos (YAML).
- **Trae tu propio modelo**: Groq, OpenAI, Anthropic, Google, OpenRouter u **Ollama/LM Studio local**.
- **Todo local**: tus notas nunca salen de tu computadora; solo el texto que va al modelo que elijas.

## Iniciar

Primera vez (Windows):

```bat
cd backend && python -m venv venv && venv\Scripts\python -m pip install -r requirements.txt && cd ..
cd frontend && npm install && cd ..
copy .env.nexo.example .env.nexo   &  copy frontend\.env.local.example frontend\.env.local
```

Después, cada vez: **doble clic en `iniciar.bat`** (prende Ollama si lo tenés, el backend y la app, y abre
http://localhost:3000). En la app: **Ajustes → APIs & Modelos** para elegir el modelo.

## La memoria (Neuromapa)

| | |
|---|---|
| 🧠 **Usar mis notas** | Opción en ⚙ del chat (activada de fábrica). Antes de los agentes, el buscador de Neuromapa (BM25 con raíces en español e inglés) elige las notas que tocan la consulta y los agentes las reciben como contexto citable **[N#]**. |
| 🗺️ **Cerebro en vivo** | Botón 🧠 del chat: el mapa 3D de Neuromapa dentro de la app. Cada agente de NexoMente aparece leyendo sus notas, igual que Claude Code. |
| ✨ **Modo Cerebro** | Botón *Modo Cerebro* del chat: el mapa 3D ocupa la escena. La pregunta flota arriba, cada experto elegido es una **luz** que nace en el centro, viaja por el cerebro hasta las notas que lee (encendiéndolas, con estelas entre una y otra), late mientras escribe y vuelve al centro al terminar; el núcleo late mientras el Coordinador integra y la respuesta se arma abajo. La app le pasa al mapa solo quién trabaja y qué notas lee (por `postMessage`, desde orígenes locales): el texto de la pregunta y de la respuesta no entra al mapa ni a su registro. |
| 💾 **Recordar** | Botón debajo de cada respuesta: la guarda como nota en `datos-mente/notas/` (la respuesta integrada, o la de cada agente si no hay síntesis), con la pregunta y enlaces a las notas que citó. En el cerebro aparece como la fuente **NexoMente**, conectada a esas notas, y desde ahí los agentes la pueden citar en consultas futuras. Guardar dos veces la misma respuesta no la duplica. |
| 🩺 **Médico** | El panel avisa notas con datos viejos: rutas que ya no existen, enlaces rotos, memorias que no entran en una lectura… |
| 🔌 **Plugin de Claude Code** | `neuromapa/` sigue siendo el plugin de Claude Code: los hooks ven en vivo lo que hace Claude Code y le pasan contexto (ver `neuromapa/README.md`). |

**Qué notas lee.** Sin configurar nada: la memoria de Claude Code (`~/.claude/projects/*/memory/`) y tus `CLAUDE.md`.
Para sumar carpetas de notas o proyectos, escribí `datos-mente/config.json` (mismo formato que
`neuromapa/demo/config.json`; ver `neuromapa/docs/como-funciona.md`).
**Qué notas escribe.** Solo las suyas, en `datos-mente/notas/` (o `NEXOMENTE_NOTAS`), con su índice `MEMORY.md`:
la memoria de Claude Code y tus `CLAUDE.md` solo se leen.

**Privacidad.** Las rutas `/api/mente/*` solo responden desde esta computadora y están apagadas en producción
(`NEXOMENTE_MENTE=on` para forzarlas). Los datos de la memoria (registro en vivo, índice, clave del mapa) quedan en
`datos-mente/`, fuera de git. El mapa se puede incrustar solo desde los orígenes locales de `NEXOMENTE_ORIGENES`.
Al compartir una conversación por link, las fuentes [N#] viajan solo con su título, nunca con la ruta del archivo.

---

## Funciones

| | |
|---|---|
| ⚡ **Streaming en vivo** | Cada agente escribe en tiempo real; podés **detener** a mitad. |
| 🧭 **Respuesta integrada** | Un Coordinador sintetiza los aportes, resuelve contradicciones y conserva las citas. |
| 🔍 **Revisión crítica** | Opcional: un Revisor señala errores, contradicciones, vacíos y afirmaciones sin fuente antes de la síntesis, y el Coordinador los corrige. |
| 💡 **Seguimientos** | Al final de cada respuesta, 3 preguntas sugeridas para continuar con un clic. |
| 📎 **Documentos (RAG)** | Adjuntá PDF, DOCX, TXT, MD, CSV, JSON o HTML. Se recuperan los fragmentos relevantes y los agentes los citan como **[D1]**. |
| 👁️ **OCR** | PDFs escaneados y fotos (PNG/JPG): un modelo **con visión** de tu proveedor transcribe cada página (o Tesseract, si está instalado en el servidor). |
| 🧠 **Búsqueda semántica** | Opcional: con un modelo de embeddings (OpenAI, Google, Ollama) los fragmentos se encuentran por significado y se combinan con BM25 (*Reciprocal Rank Fusion*). Vectores cacheados por documento. |
| 🌐 **Búsqueda web** | Nexo planifica consultas, busca con **Tavily**, **Brave** o **SearXNG** y los agentes citan **[W1]** con enlaces. |
| 🔧 **Herramientas nativas** | Modo opcional: cada agente decide qué y cuándo buscar (`buscar_web`, `buscar_documentos`) vía *function calling*; si el modelo no lo soporta, Nexo vuelve solo a la búsqueda previa. |
| 👥 **Equipos guardados** | Guardá agentes + modo + síntesis + web + instrucciones como un equipo reutilizable. |
| 🌿 **Ramas y edición** | Editá cualquier mensaje anterior o regenerá: se crea una rama y navegás entre versiones con **‹ 1/2 ›**. |
| 🪄 **Sugerir agentes** | Describí la tarea y Nexo propone el equipo. |
| 🧠 **Razonamiento ajustable** | Para modelos que "piensan" (Gemma 4, Qwen 3, o-series, Gemini): Automático, Apagado, Bajo o Alto. Apagado acelera mucho los modelos locales; las tareas cortas internas (seguimientos, sugerencias, OCR) siempre van sin razonar. |
| 🧮 **Calculadora de Mercado Libre** | Con agentes de Mercado Libre, Nexo extrae precio y costo de la consulta y calcula con código (no con el modelo) comisión + IVA, cargo fijo por tramo, envío según el umbral de envío gratis, contribución, ROAS y precio de equilibrio, y escenarios Clásica/Premium y cruzar el umbral. Los agentes reciben esas cifras exactas. Tarifas de México en `backend/app/services/ml_costs.py`. |
| 🔀 **Modos** | Paralelo (todos a la vez) o secuencial (cada agente ve un resumen de los anteriores). |
| ✍️ **Instrucciones por agente** | Tono, formato o restricciones propias (botón ⓘ en la barra lateral). |
| 💬 **Contexto** | Las preguntas de seguimiento incluyen el historial; con cuenta, también tu memoria persistente. |
| 📄 **Exportar** | Conversación en Markdown, con fuentes. |
| 🔗 **Compartir** | Link de solo lectura con una instantánea de la conversación, revocable; quien lo abre puede copiarla a su historial. |
| 💲 **Costos y presupuesto** | Cargás el precio de tus modelos y Nexo muestra el costo por consulta, el gasto del día/mes y frena al llegar a tu tope. |
| 📊 **Diagramas** | Los agentes pueden responder con diagramas Mermaid (flujos, arquitecturas, cronogramas) que se dibujan en el chat; bloques de código con botón de copiar. |
| ⌨️ **Paleta y atajos** | `Ctrl/⌘+K` busca acciones, agentes y equipos. Atajos: `Ctrl+Shift+O` nueva, `Ctrl+Shift+E` exportar, `Ctrl+Shift+L` compartir, `Ctrl+Shift+F` web, `/` escribir, `Esc` detener. |
| ⭐ **Favoritos** | Fijá tus agentes más usados arriba de la barra lateral. |
| 🧑‍🏫 **Coach de consultas** | Mientras escribís, Nexo detecta lo que le falta a la consulta: datos actuales sin búsqueda web, archivos mencionados sin adjuntar, falta de contexto, temas sensibles sin revisión o credenciales pegadas por error — cada sugerencia con su acción de un clic. |
| 🧮 **Estimación previa** | Antes de enviar: llamadas al modelo, rango de tokens y costo estimado, calibrados con tus consultas anteriores. |
| 🧩 **Análisis del equipo** | Avisa si el equipo es demasiado grande, redundante o poco diverso. |
| ✅ **Primeros pasos** | La pantalla inicial muestra qué falta configurar y ejemplos de buenas consultas. |

---

## Cómo funciona una consulta

```
consulta ──▶ [contexto]  documentos ─BM25 (+ embeddings)─▶ fragmentos [D#]
                         búsqueda web (opcional) ─▶ fuentes [W#]
         ──▶ [agentes]   N especialistas en paralelo (o secuencial), streaming
         ──▶ [revisión]  Revisor crítico (opcional)
         ──▶ [síntesis]  Coordinador integra, corrige y cita  ──▶ seguimientos sugeridos
```

Hay dos formas de obtener las fuentes (Opciones del chat → *Fuentes*):

- **Búsqueda previa** (por defecto): se busca una vez antes de los agentes y todos reciben las mismas fuentes. Funciona con cualquier modelo, incluidos los locales.
- **Herramientas nativas**: cada agente recibe `buscar_documentos` / `buscar_web` y las usa cuando las necesita (hasta 3 rondas). Las etiquetas [W#] se comparten entre agentes. Si el proveedor rechaza herramientas, Nexo avisa y usa la búsqueda previa.

## Arquitectura

```
Navegador ──HTTP /api/*──▶ Next.js (proxy) ──▶ FastAPI ──▶ LLM del usuario · buscador web
    └──────── WebSocket /ws/{id} ───────────▶ │   (SSE /api/chat-stream como respaldo)
                                              ├──▶ PostgreSQL: cuentas, historial, memoria, equipos, documentos
                                              └──▶ Redis: rate limit, usuarios online (opcional)
```

```
backend/app/
  agents/catalog/*.yaml      # los 500 agentes (prompt, emoji, especialidad…)
  services/orchestrator.py   # contexto → agentes → síntesis, eventos en vivo
  services/documents.py      # extracción, fragmentos, BM25 + embeddings (RRF), almacenamiento
  services/ocr.py            # OCR con modelo de visión o Tesseract
  services/web_search.py     # Tavily / Brave / SearXNG + planificación de consultas
  services/llm_client.py     # AsyncOpenAI cacheado, streaming, uso de tokens
  services/agent_router.py   # sugerencia de agentes
  routes/                    # auth, history, memory, documents, teams, shares, admin
frontend/src/                # ver frontend/ARCHITECTURE.md
  core/                      # protocolo tipado + reducer puro del streaming
  intelligence/              # coach de consultas, estimador, análisis de equipo
  stores/                    # Zustand (preferencias, workspace)
  features/chat/             # useChatSession + componentes del chat
  lib/chat.ts                # modelo del árbol de turnos
```

### Agregar o editar un agente

Editá el YAML de su categoría en `backend/app/agents/catalog/`. Campos: `id`, `name`, `emoji`, `description`, `short_description`, `specialization`, `complexity`, `capabilities`, `backstory`, `system_prompt`. El catálogo se valida al arrancar y en los tests.

---

## Desarrollo local (sin Docker)

Requisitos: Python 3.12+, Node 20+. PostgreSQL y Redis son **opcionales**: sin ellos Nexo funciona como invitado (historial en el navegador, documentos en memoria 24 h).

```bash
cp .env.nexo.example .env.nexo        # completar secretos (ver comentarios)

# Backend
cd backend
python -m venv venv && venv\Scripts\activate      # Linux/macOS: source venv/bin/activate
pip install -r requirements-dev.txt
uvicorn app.main:app --reload --port 8001

# Frontend (otra terminal)
cd frontend
cp .env.local.example .env.local
npm install && npm run dev                          # http://localhost:3000
```

En la app: **Ajustes → APIs & Modelos** (tu proveedor LLM) y, opcionales, **Ajustes → Búsqueda web** y **Ajustes → Documentos** (modelo con visión para OCR y modelo de embeddings).

> OCR local opcional: instalá [Tesseract](https://github.com/tesseract-ocr/tesseract) y `pip install pytesseract`; Nexo lo usa cuando no hay modelo con visión configurado.

### Tests

```bash
cd backend && python -m pytest -q                   # backend: LLM y buscador simulados, sin DB
cd frontend && npm test && npx tsc --noEmit && npx next build
```

## Con Docker

```bash
docker compose --env-file .env.nexo up -d --build
# Frontend http://localhost:3002 · Backend http://localhost:8002/api/health
# Solo infraestructura para desarrollo nativo:  docker compose --env-file .env.nexo up -d nexo-postgres nexo-redis
```

Los puertos se publican solo en `127.0.0.1`. Para exponerlo, usá un proxy con TLS que enrute `/` al frontend y `/api` + `/ws` al backend, con `ENVIRONMENT=production`, `FRONTEND_URL` y `CORS_ORIGINS`.

---

## Seguridad y privacidad

- Las API keys (LLM y buscador) las pone cada usuario, viajan por petición y **nunca se guardan en el servidor**; en el navegador solo si activás "guardar APIs".
- Secretos del servidor solo en `.env.nexo` (ignorado por git); en producción el backend no arranca sin ellos.
- Historial, memoria, equipos y documentos verifican que el recurso pertenezca al usuario del token.
- Protección SSRF en URLs de proveedores y de SearXNG; WebSocket con verificación de `Origin` y token fuera de la URL.
- Contraseñas PBKDF2-SHA256 (600k iteraciones), comparación en tiempo constante.

## Licencia

MIT. NexoMente (Nexo) — ver [LICENSE](LICENSE). Neuromapa © 2026 Cristofer Bonifacio, MIT — ver
[neuromapa/LICENSE](neuromapa/LICENSE).
