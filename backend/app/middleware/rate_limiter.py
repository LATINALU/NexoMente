"""
Nexo - Rate Limiting Middleware
==================================
Control de tasa de solicitudes para prevenir abuse y DoS
"""

import time
import logging
from typing import Dict, Optional
from fastapi import Request, HTTPException
from slowapi import Limiter
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
import redis.asyncio as redis
from app.config import REDIS_URL

logger = logging.getLogger("nexo.ratelimit")

# Inicialización de Redis para rate limiting distribuido
redis_client: Optional[redis.Redis] = None

async def init_redis():
    """Inicializar cliente Redis"""
    global redis_client
    try:
        redis_client = redis.from_url(REDIS_URL, decode_responses=True, socket_connect_timeout=2)
        await redis_client.ping()
        logger.info("Redis conectado para rate limiting")
    except Exception as e:
        logger.warning("Redis no disponible, se usa rate limiting en memoria: %s", e)
        redis_client = None

# Rate limiter principal
limiter = Limiter(key_func=get_remote_address)

class InMemoryRateLimiter:
    """Rate limiter en memoria para cuando Redis no está disponible"""
    
    def __init__(self):
        self.requests: Dict[str, list] = {}
        self.cleanup_interval = 60  # Limpiar cada 60 segundos
        self.last_cleanup = time.time()
    
    async def is_allowed(self, key: str, limit: int, window: int) -> bool:
        """Verificar si la solicitud está permitida"""
        now = time.time()
        
        # Limpiar entradas viejas periódicamente
        if now - self.last_cleanup > self.cleanup_interval:
            self._cleanup(now)
            self.last_cleanup = now
        
        # Obtener o crear entrada para esta clave
        if key not in self.requests:
            self.requests[key] = []
        
        # Remover solicitudes fuera de la ventana
        self.requests[key] = [req_time for req_time in self.requests[key] if now - req_time < window]
        
        # Verificar límite
        if len(self.requests[key]) >= limit:
            return False
        
        # Agregar solicitud actual
        self.requests[key].append(now)
        return True
    
    def _cleanup(self, now: float):
        """Limpiar entradas viejas"""
        keys_to_remove = []
        for key, times in self.requests.items():
            # Mantener solo solicitudes en la última hora
            self.requests[key] = [t for t in times if now - t < 3600]
            if not self.requests[key]:
                keys_to_remove.append(key)
        
        for key in keys_to_remove:
            del self.requests[key]

# Rate limiter en memoria como fallback
memory_limiter = InMemoryRateLimiter()

class CustomRateLimiter:
    """Rate limiter con soporte para Redis y fallback en memoria"""
    
    def __init__(self, requests: int, window: int):
        self.requests = requests
        self.window = window
        self.redis_key_prefix = "rate_limit:"
    
    async def is_allowed(self, request: Request) -> bool:
        """Verificar si la solicitud está permitida"""
        key = f"{self.redis_key_prefix}{get_remote_address(request)}:{self.window}:{self.requests}"
        
        if redis_client:
            return await self._redis_check(key)
        else:
            return await memory_limiter.is_allowed(key, self.requests, self.window)
    
    async def _redis_check(self, key: str) -> bool:
        """Verificar usando Redis"""
        try:
            # Usar pipeline atómico
            pipe = redis_client.pipeline()
            
            # Obtener conteo actual
            pipe.incr(key)
            pipe.expire(key, self.window)
            
            results = await pipe.execute()
            current_count = results[0]
            
            return current_count <= self.requests
        except Exception as e:
            logger.warning(f"Error en Redis rate limiting, usando fallback: {e}")
            return await memory_limiter.is_allowed(key, self.requests, self.window)

# Rate limiters específicos para diferentes endpoints
class RateLimiters:
    """Rate limiters predefinidos para diferentes endpoints"""
    
    # Chat endpoint - más restrictivo
    CHAT = CustomRateLimiter(requests=10, window=60)  # 10 requests por minuto
    
    # Health check - más permisivo
    HEALTH = CustomRateLimiter(requests=100, window=60)  # 100 requests por minuto
    
    # Models endpoint - medio
    MODELS = CustomRateLimiter(requests=20, window=60)  # 20 requests por minuto
    
    # WebSocket - alto pero controlado
    WEBSOCKET = CustomRateLimiter(requests=30, window=60)  # 30 conexiones por minuto

# Middleware de rate limiting
async def rate_limit_middleware(request: Request, call_next, limiter: CustomRateLimiter):
    """Middleware para aplicar rate limiting"""
    try:
        if not await limiter.is_allowed(request):
            raise HTTPException(
                status_code=429,
                detail={
                    "error": "Rate limit exceeded",
                    "message": "Too many requests. Please try again later.",
                    "retry_after": limiter.window
                },
                headers={"Retry-After": str(limiter.window)}
            )
        
        response = await call_next(request)
        return response
        
    except RateLimitExceeded:
        raise HTTPException(
            status_code=429,
            detail={
                "error": "Rate limit exceeded",
                "message": "Too many requests. Please try again later.",
                "retry_after": limiter.window
            },
            headers={"Retry-After": str(limiter.window)}
        )

# Decoradores para endpoints
def rate_limit_chat():
    """Rate limiting para endpoint /api/chat"""
    return limiter.limit("10/minute")(lambda: None)

def rate_limit_health():
    """Rate limiting para endpoint /api/health"""
    return limiter.limit("100/minute")(lambda: None)

def rate_limit_models():
    """Rate limiting para endpoint /api/models"""
    return limiter.limit("20/minute")(lambda: None)

# Función para obtener estadísticas de rate limiting
async def get_rate_limit_stats() -> Dict:
    """Obtener estadísticas de rate limiting"""
    stats = {
        "redis_connected": redis_client is not None,
        "memory_entries": len(memory_limiter.requests),
        "active_clients": 0
    }
    
    if redis_client:
        try:
            # Contar claves activas de rate limiting
            keys = await redis_client.keys(f"{memory_limiter.redis_key_prefix}*")
            stats["active_clients"] = len(keys)
        except:
            pass
    
    return stats

# init_redis() se invoca desde el lifespan de la app (necesita un event loop activo)

# Exportaciones
__all__ = [
    'limiter',
    'CustomRateLimiter',
    'RateLimiters',
    'rate_limit_middleware',
    'rate_limit_chat',
    'rate_limit_health',
    'rate_limit_models',
    'get_rate_limit_stats'
]
