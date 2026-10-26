"""
WebSocket Manager
========================
Gestiona conexiones WebSocket en tiempo real para streaming de respuestas de agentes.

Características:
- Conexiones múltiples simultáneas
- Broadcast a todos los clientes
- Envío dirigido por client_id
- Manejo robusto de desconexiones
- Tracking de usuarios en línea con Redis
"""

from fastapi import WebSocket
from typing import Dict, List, Optional
import logging
from datetime import datetime, timezone

logger = logging.getLogger("nexo.websocket_manager")


class ConnectionManager:
    """
    Gestor de conexiones WebSocket para comunicación en tiempo real.
    
    Permite:
    - Múltiples clientes conectados simultáneamente
    - Envío de mensajes individuales o broadcast
    - Tracking de estado de conexión
    """
    
    def __init__(self):
        self.active_connections: Dict[str, WebSocket] = {}
        self.connection_times: Dict[str, datetime] = {}
        self.message_counts: Dict[str, int] = {}
        self.user_metadata: Dict[str, Dict] = {}  # Metadata de usuarios conectados
    
    async def connect(self, websocket: WebSocket, client_id: str, user_metadata: Optional[Dict] = None) -> bool:
        """
        Acepta una nueva conexión WebSocket.
        
        Args:
            websocket: Instancia de WebSocket
            client_id: Identificador único del cliente
            user_metadata: Metadata del usuario (user_id, device_type, etc.)
            
        Returns:
            True si la conexión fue exitosa
        """
        try:
            await websocket.accept()
            self.active_connections[client_id] = websocket
            self.connection_times[client_id] = datetime.now(timezone.utc)
            self.message_counts[client_id] = 0
            self.user_metadata[client_id] = user_metadata or {}
            
            logger.info(f"WebSocket conectado: {client_id}")
            return True
        except Exception as e:
            logger.error(f"Error conectando WebSocket {client_id}: {e}")
            return False
    
    def disconnect(self, client_id: str):
        """
        Desconecta un cliente y limpia sus recursos.
        
        Args:
            client_id: Identificador del cliente a desconectar
        """
        if client_id in self.active_connections:
            del self.active_connections[client_id]
            
            # Calcular duración de sesión
            if client_id in self.connection_times:
                duration = datetime.now(timezone.utc) - self.connection_times[client_id]
                messages = self.message_counts.get(client_id, 0)
                logger.info(f"📴 WebSocket desconectado: {client_id} (duración: {duration}, mensajes: {messages})")
                del self.connection_times[client_id]
            
            if client_id in self.message_counts:
                del self.message_counts[client_id]
            
            if client_id in self.user_metadata:
                del self.user_metadata[client_id]
    
    def is_connected(self, client_id: str) -> bool:
        """Verifica si un cliente está conectado."""
        return client_id in self.active_connections
    
    async def send_json(self, client_id: str, data: dict) -> bool:
        """
        Envía datos JSON a un cliente específico.
        
        Args:
            client_id: Identificador del cliente
            data: Diccionario a enviar como JSON
            
        Returns:
            True si el envío fue exitoso
        """
        if client_id not in self.active_connections:
            return False
        
        try:
            await self.active_connections[client_id].send_json(data)
            self.message_counts[client_id] = self.message_counts.get(client_id, 0) + 1
            return True
        except Exception as e:
            logger.warning(f"Error enviando a {client_id}: {e}")
            self.disconnect(client_id)
            return False
    
    async def send_text(self, client_id: str, message: str) -> bool:
        """
        Envía texto plano a un cliente específico.
        
        Args:
            client_id: Identificador del cliente
            message: Mensaje de texto a enviar
            
        Returns:
            True si el envío fue exitoso
        """
        if client_id not in self.active_connections:
            return False
        
        try:
            await self.active_connections[client_id].send_text(message)
            self.message_counts[client_id] = self.message_counts.get(client_id, 0) + 1
            return True
        except Exception as e:
            logger.warning(f"Error enviando texto a {client_id}: {e}")
            self.disconnect(client_id)
            return False
    
    async def broadcast(self, data: dict, exclude: Optional[List[str]] = None):
        """
        Envía datos a todos los clientes conectados.
        
        Args:
            data: Diccionario a enviar
            exclude: Lista de client_ids a excluir del broadcast
        """
        exclude = exclude or []
        disconnected = []
        
        for client_id, connection in self.active_connections.items():
            if client_id in exclude:
                continue
            
            try:
                await connection.send_json(data)
                self.message_counts[client_id] = self.message_counts.get(client_id, 0) + 1
            except Exception as e:
                logger.warning(f"Error en broadcast a {client_id}: {e}")
                disconnected.append(client_id)
        
        # Limpiar conexiones fallidas
        for client_id in disconnected:
            self.disconnect(client_id)
    
    async def send_agent_start(self, client_id: str, agent_name: str, step: int, total: int):
        """
        Notifica el inicio de procesamiento de un agente.
        
        Args:
            client_id: Cliente destino
            agent_name: Nombre del agente
            step: Paso actual (1-indexed)
            total: Total de pasos
        """
        await self.send_json(client_id, {
            "type": "agent_start",
            "agent": agent_name,
            "step": step,
            "total": total,
            "timestamp": datetime.now(timezone.utc).isoformat()
        })
    
    async def send_agent_progress(self, client_id: str, agent_name: str, progress: int, message: str):
        """
        Envía actualización de progreso de un agente.
        
        Args:
            client_id: Cliente destino
            agent_name: Nombre del agente
            progress: Porcentaje de progreso (0-100)
            message: Mensaje de estado
        """
        await self.send_json(client_id, {
            "type": "agent_progress",
            "agent": agent_name,
            "progress": progress,
            "message": message,
            "timestamp": datetime.now(timezone.utc).isoformat()
        })
    
    async def send_agent_response(self, client_id: str, response_data: dict):
        """
        Envía la respuesta completa de un agente.
        
        Args:
            client_id: Cliente destino
            response_data: Datos de respuesta formateados
        """
        await self.send_json(client_id, {
            "type": "agent_response",
            "data": response_data,
            "timestamp": datetime.now(timezone.utc).isoformat()
        })
    
    async def send_agent_error(self, client_id: str, agent_name: str, error: str):
        """
        Notifica un error en el procesamiento de un agente.
        
        Args:
            client_id: Cliente destino
            agent_name: Nombre del agente con error
            error: Descripción del error
        """
        await self.send_json(client_id, {
            "type": "agent_error",
            "agent": agent_name,
            "error": error,
            "timestamp": datetime.now(timezone.utc).isoformat()
        })
    
    async def send_pipeline_complete(self, client_id: str, summary: dict):
        """
        Notifica la finalización del pipeline completo.
        
        Args:
            client_id: Cliente destino
            summary: Resumen del procesamiento
        """
        await self.send_json(client_id, {
            "type": "pipeline_complete",
            "data": summary,
            "timestamp": datetime.now(timezone.utc).isoformat()
        })
    
    def get_stats(self) -> dict:
        """Retorna estadísticas de conexiones."""
        return {
            "active_connections": len(self.active_connections),
            "client_ids": list(self.active_connections.keys()),
            "total_messages": sum(self.message_counts.values())
        }


# Instancia global del manager
manager = ConnectionManager()
