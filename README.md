<p align="center"><img src="frontend/public/favicon.svg" width="88" alt="Nexo"></p>

<h1 align="center">Nexo</h1>
<p align="center"><b>Equipos de agentes IA que investigan, leen tus documentos y responden juntos.</b></p>

Elegís un equipo de especialistas (o dejás que Nexo lo arme), los agentes trabajan **en paralelo** sobre tu consulta con **streaming token a token**, consultan **tus documentos** y **la web**, y un **Coordinador** integra todo en una respuesta final con **fuentes citadas**.

- **500 agentes** en **50 categorías**, definidos como datos (YAML).
- **Trae tu propia API key**: Groq, OpenAI, Anthropic, Google, OpenRouter u Ollama/LM Studio local.
- Funciona como invitado (todo en el navegador) o con cuenta (historial, memoria y equipos sincronizados).

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

MIT — ver [LICENSE](LICENSE).
