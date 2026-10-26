"""
Admin Routes
==================
Endpoints administrativos para monitoreo y gestión del sistema.
"""

from fastapi import APIRouter, HTTPException, Depends, Request
from typing import Optional
from datetime import datetime, timezone
import psutil
import os

from app.auth import require_admin
from app.services.online_users_tracker import get_tracker
from app.websocket_manager import manager
from app.middleware.rate_limiter import limiter, get_rate_limit_stats as _rate_limit_stats

# PostgreSQL database (primary)
from app.pg_database import pg_db

router = APIRouter(prefix="/api/admin", tags=["admin"])


@router.get("/stats/online-users")
@limiter.limit("30/minute")
async def get_online_users_stats(
    request: Request,
    admin: dict = Depends(require_admin)
):
    """
    Obtiene estadísticas de usuarios en línea en tiempo real.
    
    Requiere rol de administrador.
    
    Returns:
        Estadísticas detalladas de usuarios conectados
    """
    tracker = get_tracker()
    
    # Obtener estadísticas generales
    stats = await tracker.get_stats()
    
    # Obtener lista de usuarios en línea
    online_users = await tracker.get_online_users()
    
    # Procesar datos para el admin
    users_summary = []
    for user in online_users:
        users_summary.append({
            "user_id": user.get("user_id"),
            "session_id": user.get("session_id"),
            "device_type": user.get("device_type", "unknown"),
            "connected_at": user.get("connected_at"),
            "last_activity": user.get("last_activity"),
            "duration_seconds": _calculate_duration(user.get("connected_at"))
        })
    
    return {
        "success": True,
        "stats": stats,
        "users": users_summary,
        "timestamp": datetime.now(timezone.utc).isoformat()
    }


@router.get("/stats/system")
@limiter.limit("20/minute")
async def get_system_stats(
    request: Request,
    admin: dict = Depends(require_admin)
):
    """
    Obtiene estadísticas del sistema (CPU, memoria, disco).
    
    Requiere rol de administrador.
    
    Returns:
        Métricas del sistema
    """
    try:
        # CPU
        cpu_percent = psutil.cpu_percent(interval=1)
        cpu_count = psutil.cpu_count()
        
        # Memoria
        memory = psutil.virtual_memory()
        
        # Disco
        disk = psutil.disk_usage('/')
        
        # Procesos
        process = psutil.Process(os.getpid())
        process_memory = process.memory_info().rss / 1024 / 1024  # MB
        
        return {
            "success": True,
            "system": {
                "cpu": {
                    "percent": cpu_percent,
                    "count": cpu_count
                },
                "memory": {
                    "total_mb": memory.total / 1024 / 1024,
                    "available_mb": memory.available / 1024 / 1024,
                    "used_mb": memory.used / 1024 / 1024,
                    "percent": memory.percent
                },
                "disk": {
                    "total_gb": disk.total / 1024 / 1024 / 1024,
                    "used_gb": disk.used / 1024 / 1024 / 1024,
                    "free_gb": disk.free / 1024 / 1024 / 1024,
                    "percent": disk.percent
                },
                "process": {
                    "memory_mb": process_memory,
                    "threads": process.num_threads()
                }
            },
            "timestamp": datetime.now(timezone.utc).isoformat()
        }
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Error getting system stats: {str(e)}"
        )


@router.get("/stats/websocket")
@limiter.limit("30/minute")
async def get_websocket_stats(
    request: Request,
    admin: dict = Depends(require_admin)
):
    """
    Obtiene estadísticas de conexiones WebSocket.
    
    Requiere rol de administrador.
    
    Returns:
        Estadísticas de WebSocket
    """
    ws_stats = manager.get_stats()
    
    # Agregar información detallada de conexiones
    connections_detail = []
    for client_id in ws_stats.get("client_ids", []):
        if client_id in manager.connection_times:
            connected_at = manager.connection_times[client_id]
            duration = datetime.now(timezone.utc) - connected_at
            
            connections_detail.append({
                "client_id": client_id,
                "connected_at": connected_at.isoformat(),
                "duration_seconds": duration.total_seconds(),
                "messages_sent": manager.message_counts.get(client_id, 0)
            })
    
    return {
        "success": True,
        "stats": {
            "active_connections": ws_stats.get("active_connections", 0),
            "total_messages": ws_stats.get("total_messages", 0),
            "connections": connections_detail
        },
        "timestamp": datetime.now(timezone.utc).isoformat()
    }


@router.get("/stats/rate-limits")
@limiter.limit("20/minute")
async def rate_limit_stats(
    request: Request,
    admin: dict = Depends(require_admin)
):
    """
    Obtiene estadísticas de rate limiting.
    
    Requiere rol de administrador.
    
    Returns:
        Estadísticas de rate limiting
    """
    try:
        stats = await _rate_limit_stats()
        return {
            "success": True,
            "stats": stats,
            "timestamp": datetime.now(timezone.utc).isoformat()
        }
    except Exception as e:
        return {
            "success": False,
            "error": str(e),
            "timestamp": datetime.now(timezone.utc).isoformat()
        }


@router.get("/stats/users")
@limiter.limit("20/minute")
async def get_users_stats(
    request: Request,
    admin: dict = Depends(require_admin)
):
    """
    Obtiene estadísticas de usuarios registrados.
    
    Requiere rol de administrador.
    
    Returns:
        Estadísticas de usuarios
    """
    stats = await pg_db.get_stats()
    return {"success": True, "stats": stats, "timestamp": datetime.now(timezone.utc).isoformat()}


@router.get("/stats/dashboard")
@limiter.limit("20/minute")
async def get_dashboard_stats(
    request: Request,
    admin: dict = Depends(require_admin)
):
    """
    Obtiene todas las estadísticas para el dashboard de admin.
    
    Requiere rol de administrador.
    
    Returns:
        Estadísticas completas del sistema
    """
    tracker = get_tracker()
    
    # Obtener todas las estadísticas
    online_stats = await tracker.get_stats()
    ws_stats = manager.get_stats()
    
    try:
        system_cpu = psutil.cpu_percent(interval=0.5)
        system_memory = psutil.virtual_memory().percent
    except:
        system_cpu = 0
        system_memory = 0
    
    return {
        "success": True,
        "dashboard": {
            "online_users": online_stats.get("online_users", 0),
            "peak_users": online_stats.get("peak_users", 0),
            "active_sessions": online_stats.get("total_sessions", 0),
            "websocket_connections": ws_stats.get("active_connections", 0),
            "system_cpu_percent": system_cpu,
            "system_memory_percent": system_memory,
            "device_breakdown": online_stats.get("device_breakdown", {}),
        },
        "timestamp": datetime.now(timezone.utc).isoformat()
    }


@router.post("/broadcast")
@limiter.limit("10/minute")
async def broadcast_message(
    request: Request,
    message: str,
    admin: dict = Depends(require_admin)
):
    """
    Envía un mensaje broadcast a todos los usuarios conectados.
    
    Requiere rol de administrador.
    
    Args:
        message: Mensaje a enviar
        
    Returns:
        Confirmación del broadcast
    """
    if not message or len(message) > 500:
        raise HTTPException(
            status_code=400,
            detail="Message must be between 1 and 500 characters"
        )
    
    # Enviar broadcast
    await manager.broadcast({
        "type": "admin_broadcast",
        "message": message,
        "timestamp": datetime.now(timezone.utc).isoformat()
    })
    
    return {
        "success": True,
        "message": "Broadcast sent",
        "recipients": len(manager.active_connections),
        "timestamp": datetime.now(timezone.utc).isoformat()
    }


@router.post("/users/{user_id}/disconnect")
@limiter.limit("10/minute")
async def disconnect_user(
    request: Request,
    user_id: str,
    admin: dict = Depends(require_admin)
):
    """
    Desconecta todas las sesiones de un usuario.
    
    Requiere rol de administrador.
    
    Args:
        user_id: ID del usuario a desconectar
        
    Returns:
        Confirmación de desconexión
    """
    tracker = get_tracker()
    sessions = await tracker.get_user_sessions(user_id)
    
    disconnected = 0
    for session in sessions:
        session_id = session.get("session_id")
        if session_id in manager.active_connections:
            # Enviar notificación de desconexión
            await manager.send_json(session_id, {
                "type": "admin_disconnect",
                "message": "You have been disconnected by an administrator",
                "timestamp": datetime.now(timezone.utc).isoformat()
            })
            
            # Desconectar
            manager.disconnect(session_id)
            await tracker.remove_user(session_id)
            disconnected += 1
    
    return {
        "success": True,
        "user_id": user_id,
        "sessions_disconnected": disconnected,
        "timestamp": datetime.now(timezone.utc).isoformat()
    }


def _calculate_duration(connected_at: Optional[str]) -> float:
    """
    Calcula la duración de una sesión en segundos.
    
    Args:
        connected_at: Timestamp ISO de conexión
        
    Returns:
        Duración en segundos
    """
    if not connected_at:
        return 0.0
    
    try:
        connected = datetime.fromisoformat(connected_at)
        duration = datetime.now(timezone.utc) - connected
        return duration.total_seconds()
    except:
        return 0.0
