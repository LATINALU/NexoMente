"""
Human Response Formatter
===============================
Convierte respuestas técnicas de IA a lenguaje humano comprensible.

Características:
- Detección automática de tipo de respuesta
- Formateo específico por tipo (JSON, lista, texto, código)
- Estructura consistente para el frontend
- Resúmenes automáticos
"""

from typing import Any, Dict, List
from datetime import datetime, timezone
import re
import json


class HumanResponseFormatter:
    """
    Transforma respuestas de IA a formato legible para humanos.
    
    Soporta múltiples tipos de contenido:
    - JSON/Diccionarios estructurados
    - Listas de elementos
    - Texto plano y análisis
    - Bloques de código
    - Respuestas mixtas
    """
    
    # Configuración de emojis por tipo de agente
    AGENT_EMOJIS = {
        "reasoning": "🧠",
        "planning": "📋",
        "research": "🔍",
        "analysis": "📊",
        "synthesis": "✨",
        "critical_thinking": "⚠️",
        "coding": "💻",
        "data": "📈",
        "writing": "✍️",
        "communication": "💬",
        "decision": "⚖️",
        "problem_solving": "💡",
        "legal": "⚖️",
        "financial": "💰",
        "creative": "🎨",
        "technical": "🔧",
        "educational": "🎓",
        "marketing": "📢",
        "qa": "✅",
        "documentation": "📝",
        "optimization": "⚡",
        "security": "🔒",
        "integration": "🔗",
        "review": "👁️",
        "translation": "🌐",
        "summary": "📑",
        "formatting": "🎯",
        "validation": "✔️",
        "coordination": "🤝",
        "explanation": "💭"
    }
    
    # Traducciones
    TRANS = {
        "es": {
            "analysis_title": "📊 Análisis Estructurado",
            "results_title": "📋 Resultados",
            "identified_elements": "Elementos identificados",
            "explanation_title": "📝 Explicación",
            "tech_solution": "💻 Solución Técnica",
            "implement": "Implementación",
            "detailed_analysis": "📝 Análisis Detallado",
            "content_title": "Contenido",
            "response_title": "📝 Respuesta",
            "process_completed": "🎯 Proceso Completado",
            "process_error": "⚠️ Proceso con Errores",
            "agents_executed": "agentes ejecutados",
            "total_time": "Tiempo total",
            "analysis_completed": "Todos los análisis completados",
            "some_failed": "Algunos agentes fallaron",
            "categories": "categorías principales",
            "elements": "elementos",
            "and_more": "y {n} más",
            "paragraphs": "párrafos",
            "words": "palabras"
        },
        "en": {
            "analysis_title": "📊 Structured Analysis",
            "results_title": "📋 Results",
            "identified_elements": "Identified elements",
            "explanation_title": "📝 Explanation",
            "tech_solution": "💻 Technical Solution",
            "implement": "Implementation",
            "detailed_analysis": "📝 Detailed Analysis",
            "content_title": "Content",
            "response_title": "📝 Response",
            "process_completed": "🎯 Process Completed",
            "process_error": "⚠️ Process with Errors",
            "agents_executed": "agents executed",
            "total_time": "Total time",
            "analysis_completed": "All analyses completed",
            "some_failed": "Some agents failed",
            "categories": "main categories",
            "elements": "elements",
            "and_more": "and {n} more",
            "paragraphs": "paragraphs",
            "words": "words"
        }
    }

    # Configuración de colores y nombres por nivel
    LEVEL_COLORS = {
        1: {"primary": "#3B82F6", "bg": "rgba(59, 130, 246, 0.1)", "names": {"es": "Lógica y Fundación", "en": "Logic & Foundation"}},
        2: {"primary": "#10B981", "bg": "rgba(16, 185, 129, 0.1)", "names": {"es": "Producción Profesional", "en": "Production Professional"}},
        3: {"primary": "#F59E0B", "bg": "rgba(245, 158, 11, 0.1)", "names": {"es": "Dominios Especializados", "en": "Specialized Domains"}},
        4: {"primary": "#F43F5E", "bg": "rgba(244, 63, 94, 0.1)", "names": {"es": "Soporte Operacional", "en": "Operational Support"}},
        5: {"primary": "#8B5CF6", "bg": "rgba(139, 92, 246, 0.1)", "names": {"es": "Auxiliares Estratégicos", "en": "Strategic Auxiliaries"}}
    }
    
    @classmethod
    def format_agent_response(
        cls,
        raw_response: Any,
        agent_id: str,
        agent_name: str,
        level: int,
        specialty: str,
        step: int = 1,
        total_steps: int = 1,
        language: str = "es"
    ) -> Dict[str, Any]:
        """
        Transforma la respuesta de un agente a formato estructurado para UI.
        
        Args:
            raw_response: Respuesta cruda del agente
            agent_id: ID del agente
            agent_name: Nombre legible del agente
            level: Nivel de expertise (1-5)
            specialty: Especialización del agente
            step: Paso actual en el pipeline
            total_steps: Total de pasos
            
        Returns:
            Diccionario con respuesta formateada para frontend
        """
        # Detectar tipo de respuesta
        response_type = cls._detect_response_type(raw_response)
        
        # Obtener emoji del agente
        agent_key = agent_id.split('_')[0] if '_' in agent_id else agent_id
        emoji = cls.AGENT_EMOJIS.get(agent_key, "🤖")
        
        # Obtener configuración de color por nivel
        level_config = cls.LEVEL_COLORS.get(level, cls.LEVEL_COLORS[3])
        
        # Base de respuesta formateada
        formatted = {
            "agent_id": agent_id,
            "agent_name": agent_name,
            "agent_emoji": emoji,
            "level": level,
            "level_name": level_config["names"].get(language, level_config["names"]["es"]),
            "level_color": level_config["primary"],
            "level_bg": level_config["bg"],
            "specialty": specialty,
            "response_type": response_type,
            "step": step,
            "total_steps": total_steps,
            "progress": round((step / total_steps) * 100, 1),
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        
        # Formatear contenido según tipo
        if response_type == "json":
            content_data = cls._format_json_response(raw_response)
        elif response_type == "list":
            content_data = cls._format_list_response(raw_response)
        elif response_type == "code":
            content_data = cls._format_code_response(raw_response)
        elif response_type == "markdown":
            content_data = cls._format_markdown_response(raw_response)
        else:
            content_data = cls._format_text_response(raw_response)
        
        formatted.update(content_data)
        
        return formatted
    
    @classmethod
    def _detect_response_type(cls, response: Any) -> str:
        """
        Detecta el tipo de respuesta para aplicar el formateo correcto.
        
        Args:
            response: Respuesta a analizar
            
        Returns:
            Tipo de respuesta: 'json', 'list', 'code', 'markdown', 'text'
        """
        if isinstance(response, dict):
            return "json"
        
        if isinstance(response, list):
            return "list"
        
        if isinstance(response, str):
            # Detectar código
            code_indicators = ["```", "def ", "class ", "import ", "function ", "const ", "let ", "var "]
            if any(indicator in response for indicator in code_indicators):
                return "code"
            
            # Detectar markdown
            markdown_indicators = ["# ", "## ", "### ", "**", "- ", "* ", "1. ", "> "]
            if any(indicator in response for indicator in markdown_indicators):
                return "markdown"
            
            return "text"
        
        return "generic"
    
    @classmethod
    def _format_json_response(cls, data: dict) -> dict:
        """Formatea respuestas tipo JSON/diccionario."""
        sections = []
        key_points = []
        
        for key, value in data.items():
            # Formatear clave para legibilidad
            formatted_key = key.replace("_", " ").title()
            
            if isinstance(value, dict):
                section = {
                    "title": f"📂 {formatted_key}",
                    "type": "nested",
                    "items": [f"• **{k.replace('_', ' ').title()}**: {v}" for k, v in value.items()]
                }
                sections.append(section)
                key_points.append(f"{formatted_key}: {len(value)} elementos")
                
            elif isinstance(value, list):
                section = {
                    "title": f"📋 {formatted_key}",
                    "type": "list",
                    "items": [f"• {item}" for item in value[:10]]  # Limitar a 10 items
                }
                if len(value) > 10:
                    section["items"].append(f"... y {len(value) - 10} más")
                sections.append(section)
                key_points.append(f"{formatted_key}: {len(value)} elementos")
                
            else:
                key_points.append(f"**{formatted_key}**: {value}")
        
        return {
            "title": "📊 Análisis Estructurado",
            "sections": sections,
            "key_points": key_points,
            "summary": f"Análisis con {len(data)} categorías principales",
            "raw_content": json.dumps(data, indent=2, ensure_ascii=False) if data else ""
        }
    
    @classmethod
    def _format_list_response(cls, items: list) -> dict:
        """Formatea respuestas tipo lista."""
        formatted_items = []
        
        for i, item in enumerate(items, 1):
            if isinstance(item, dict):
                # Lista de objetos
                item_text = " | ".join([f"{k}: {v}" for k, v in item.items()])
                formatted_items.append(f"{i}. {item_text}")
            else:
                formatted_items.append(f"{i}. {item}")
        
        return {
            "title": "📋 Resultados",
            "sections": [{
                "title": "Elementos identificados",
                "type": "numbered_list",
                "items": formatted_items
            }],
            "key_points": [f"Total: {len(items)} elementos"],
            "summary": f"Lista con {len(items)} elementos identificados",
            "raw_content": "\n".join(formatted_items)
        }
    
    @classmethod
    def _format_code_response(cls, code: str) -> dict:
        """Formatea respuestas con código."""
        # Detectar lenguaje
        language = "python"  # Default
        if "function " in code or "const " in code or "let " in code:
            language = "javascript"
        elif "public class" in code or "private void" in code:
            language = "java"
        elif "<html" in code.lower() or "<div" in code.lower():
            language = "html"
        
        # Extraer bloques de código si están en markdown
        code_blocks = re.findall(r'```(\w*)\n(.*?)```', code, re.DOTALL)
        
        if code_blocks:
            sections = []
            for lang, block in code_blocks:
                sections.append({
                    "title": f"💻 Código {lang.upper() or language.upper()}",
                    "type": "code",
                    "language": lang or language,
                    "content": block.strip()
                })
            
            # Extraer texto explicativo
            explanation = re.sub(r'```.*?```', '', code, flags=re.DOTALL).strip()
            if explanation:
                sections.insert(0, {
                    "title": "📝 Explicación",
                    "type": "text",
                    "content": explanation
                })
            
            return {
                "title": "💻 Solución Técnica",
                "sections": sections,
                "key_points": [f"{len(code_blocks)} bloque(s) de código"],
                "summary": "Implementación con código fuente",
                "raw_content": code
            }
        
        return {
            "title": "💻 Código",
            "sections": [{
                "title": f"Implementación {language.upper()}",
                "type": "code",
                "language": language,
                "content": code
            }],
            "key_points": [f"Lenguaje: {language}"],
            "summary": "Solución técnica implementada",
            "raw_content": code
        }
    
    @classmethod
    def _format_markdown_response(cls, text: str) -> dict:
        """Formatea respuestas en Markdown."""
        sections = []
        current_section = {"title": "Contenido", "type": "markdown", "items": []}
        
        lines = text.split('\n')
        
        for line in lines:
            # Detectar headers
            if line.startswith('### '):
                if current_section["items"]:
                    sections.append(current_section)
                current_section = {"title": line[4:].strip(), "type": "subsection", "items": []}
            elif line.startswith('## '):
                if current_section["items"]:
                    sections.append(current_section)
                current_section = {"title": line[3:].strip(), "type": "section", "items": []}
            elif line.startswith('# '):
                if current_section["items"]:
                    sections.append(current_section)
                current_section = {"title": line[2:].strip(), "type": "header", "items": []}
            elif line.strip():
                current_section["items"].append(line)
        
        if current_section["items"]:
            sections.append(current_section)
        
        # Extraer puntos clave (bullets y números)
        key_points = []
        for line in lines:
            if line.strip().startswith(('- ', '* ', '• ')):
                key_points.append(line.strip()[2:])
            elif re.match(r'^\d+\.\s', line.strip()):
                key_points.append(re.sub(r'^\d+\.\s', '', line.strip()))
        
        return {
            "title": "📝 Análisis Detallado",
            "sections": sections if sections else [{"title": "Contenido", "type": "markdown", "items": lines}],
            "key_points": key_points[:5] if key_points else ["Análisis completo disponible"],
            "summary": f"Documento con {len(sections)} secciones",
            "raw_content": text
        }
    
    @classmethod
    def _format_text_response(cls, text: str) -> dict:
        """Formatea respuestas de texto plano."""
        # Dividir en párrafos
        paragraphs = [p.strip() for p in text.split('\n\n') if p.strip()]
        
        if not paragraphs:
            paragraphs = [p.strip() for p in text.split('\n') if p.strip()]
        
        # Extraer primera oración como resumen
        first_sentence = ""
        if paragraphs:
            match = re.match(r'^([^.!?]+[.!?])', paragraphs[0])
            if match:
                first_sentence = match.group(1)
        
        # Contar palabras
        word_count = len(text.split())
        
        return {
            "title": "📝 Respuesta",
            "sections": [{
                "title": "Contenido",
                "type": "paragraphs",
                "items": paragraphs
            }],
            "key_points": [f"{word_count} palabras", f"{len(paragraphs)} párrafos"],
            "summary": first_sentence or f"Análisis de {word_count} palabras",
            "raw_content": text
        }
    
    @classmethod
    def create_pipeline_summary(
        cls,
        agents_completed: List[str],
        total_time_ms: float,
        success: bool = True,
        language: str = "es"
    ) -> dict:
        """
        Crea un resumen del pipeline completo.
        """
        t = cls.TRANS.get(language, cls.TRANS["es"])
        
        return {
            "type": "pipeline_summary",
            "title": t["process_completed"] if success else t["process_error"],
            "status": "success" if success else "error",
            "agents_count": len(agents_completed),
            "agents": agents_completed,
            "processing_time_ms": round(total_time_ms, 2),
            "processing_time_formatted": cls._format_time(total_time_ms),
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "summary_points": [
                f"✅ {len(agents_completed)} {t['agents_executed']}",
                f"⏱️ {t['total_time']}: {cls._format_time(total_time_ms)}",
                f"📊 {t['analysis_completed']}" if success else f"⚠️ {t['some_failed']}"
            ]
        }
    
    @staticmethod
    def _format_time(ms: float) -> str:
        """Formatea milisegundos a string legible."""
        if ms < 1000:
            return f"{ms:.0f}ms"
        elif ms < 60000:
            return f"{ms/1000:.1f}s"
        else:
            minutes = int(ms // 60000)
            seconds = (ms % 60000) / 1000
            return f"{minutes}m {seconds:.0f}s"
