"""
Nexo - PostgreSQL Database Layer
=======================================
Async PostgreSQL adapter using asyncpg for multi-user support.
"""

import asyncpg
import secrets
import hashlib
import hmac
import json
import logging
from datetime import datetime
from typing import Optional, Dict, List, Any
from pathlib import Path

from app.config import DATABASE_URL as PG_URL, ADMIN_USERNAME, ADMIN_EMAIL, ADMIN_PASSWORD

logger = logging.getLogger("nexo.db")

# PBKDF2-SHA256 (recomendación OWASP 2023+). Los hashes viejos de 100k siguen verificando.
PBKDF2_ITERATIONS = 600_000


class PgDatabase:
    """Async PostgreSQL database manager for Nexo"""

    _instance = None
    _pool: Optional[asyncpg.Pool] = None

    @classmethod
    def get_instance(cls):
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    async def initialize(self):
        """Initialize connection pool and run migrations"""
        if self._pool is not None:
            return

        try:
            self._pool = await asyncpg.create_pool(
                PG_URL,
                min_size=2,
                max_size=20,
                command_timeout=30,
                timeout=5,
            )
            logger.info("PostgreSQL pool conectado")
            # Run migrations
            await self._run_migrations()
            logger.info("Migraciones PostgreSQL ejecutadas")
            # Create default admin
            await self._create_default_admin()

        except Exception as e:
            logger.error(f"Error conectando PostgreSQL: {e}")
            raise

    async def _run_migrations(self):
        """Execute SQL migration files"""
        migrations_dir = Path(__file__).parent / "migrations"
        if not migrations_dir.exists():
            return

        for sql_file in sorted(migrations_dir.glob("*.sql")):
            sql = sql_file.read_text(encoding="utf-8")
            async with self._pool.acquire() as conn:
                await conn.execute(sql)
            logger.info(f"  📦 Migration: {sql_file.name}")
    async def close(self):
        """Close connection pool"""
        if self._pool:
            await self._pool.close()
            self._pool = None

    # ================================================================
    # User Management
    # ================================================================

    @staticmethod
    def _hash_password(password: str) -> str:
        salt = secrets.token_hex(16)
        pwd_hash = hashlib.pbkdf2_hmac('sha256', password.encode(), salt.encode(), PBKDF2_ITERATIONS)
        return f"pbkdf2${PBKDF2_ITERATIONS}${salt}${pwd_hash.hex()}"

    @staticmethod
    def _verify_password(password: str, password_hash: str) -> bool:
        try:
            parts = password_hash.split('$')
            if len(parts) == 4:  # formato actual: pbkdf2$iter$salt$hash
                _, iterations, salt, pwd_hash = parts
                iterations = int(iterations)
            else:  # formato legacy: salt$hash (100k iteraciones)
                salt, pwd_hash = parts
                iterations = 100_000
            new_hash = hashlib.pbkdf2_hmac('sha256', password.encode(), salt.encode(), iterations)
            return hmac.compare_digest(new_hash.hex(), pwd_hash)
        except Exception:
            return False

    @staticmethod
    def _generate_user_code() -> str:
        return f"#{secrets.token_hex(3).upper()}"

    async def _create_default_admin(self):
        """Crea el admin inicial desde ADMIN_* si no existe. Sin ADMIN_PASSWORD no se crea."""
        if not ADMIN_PASSWORD:
            logger.info("ADMIN_PASSWORD vacío: no se crea usuario admin inicial.")
            return
        if await self.get_user_by_username(ADMIN_USERNAME):
            return
        try:
            await self.create_user(ADMIN_USERNAME, ADMIN_EMAIL, ADMIN_PASSWORD, role="admin")
            logger.info("Admin inicial '%s' creado", ADMIN_USERNAME)
        except ValueError:
            pass  # ya existe

    async def create_user(self, username: str, email: str, password: str,
                          role: str = "free", auth_user_id: str = None) -> Dict[str, Any]:
        """Create a new Nexo user profile"""
        password_hash = self._hash_password(password)
        user_code = self._generate_user_code()
        user_id = None

        async with self._pool.acquire() as conn:
            # Check for existing username/email
            taken = await conn.fetchrow(
                "SELECT id FROM public.nexo_profiles WHERE lower(username) = lower($1) OR lower(email) = lower($2)",
                username, email
            )
            if taken:
                raise ValueError("El usuario o email ya está registrado")
            while await conn.fetchval("SELECT 1 FROM public.nexo_profiles WHERE user_code = $1", user_code):
                user_code = self._generate_user_code()

            row = await conn.fetchrow("""
                INSERT INTO public.nexo_profiles 
                    (auth_user_id, username, email, display_name, user_code, role)
                VALUES ($1, $2, $3, $4, $5, $6)
                RETURNING id, username, display_name, user_code, role, created_at
            """, auth_user_id, username, email, username, user_code, role)

            user_id = str(row['id'])

            # El hash de la contraseña se guarda en preferences.settings (nunca se expone)
            await conn.execute("""
                INSERT INTO public.nexo_user_preferences (user_id, settings)
                VALUES ($1, $2)
            """, row['id'], json.dumps({"password_hash": password_hash}))

            # Create initial usage record
            current_month = datetime.now().strftime("%Y-%m")
            await conn.execute("""
                INSERT INTO public.nexo_usage (user_id, month) VALUES ($1, $2)
                ON CONFLICT (user_id, month) DO NOTHING
            """, row['id'], current_month)

            # Create subscription
            await conn.execute("""
                INSERT INTO public.nexo_subscriptions (user_id, plan, monthly_queries, max_agents)
                VALUES ($1, $2, $3, $4)
            """, row['id'], role,
                -1 if role == "admin" else 1000 if role == "premium" else 50,
                -1 if role == "admin" else 500 if role == "premium" else 10)

        return {
            "id": user_id,
            "username": row['username'],
            "display_name": row['display_name'],
            "email": email,
            "user_code": row['user_code'],
            "role": row['role'],
            "created_at": row['created_at'].isoformat() if row['created_at'] else None,
        }

    async def authenticate_user(self, username: str, password: str) -> Optional[Dict[str, Any]]:
        """Authenticate user by username/email"""
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow("""
                SELECT p.id, p.username, p.email, p.display_name, p.user_code, p.role, p.is_active,
                       pref.settings
                FROM public.nexo_profiles p
                LEFT JOIN public.nexo_user_preferences pref ON pref.user_id = p.id
                WHERE lower(p.username) = lower($1) OR lower(p.email) = lower($1)
            """, username)

            if not row:
                return None

            if not row['is_active']:
                return None

            # Verify password from settings
            settings = json.loads(row['settings']) if row['settings'] else {}
            password_hash = settings.get('password_hash')
            if not password_hash or not self._verify_password(password, password_hash):
                return None

            # Update last login
            await conn.execute(
                "UPDATE public.nexo_profiles SET last_login = NOW() WHERE id = $1",
                row['id']
            )

            return {
                "id": str(row['id']),
                "username": row['username'],
                "email": row['email'],
                "display_name": row['display_name'],
                "user_code": row['user_code'],
                "role": row['role'],
            }

    async def get_user_by_id(self, user_id: str) -> Optional[Dict[str, Any]]:
        async with self._pool.acquire() as conn:
            import uuid
            try:
                uid = uuid.UUID(user_id)
            except (ValueError, AttributeError):
                return None
            row = await conn.fetchrow("""
                SELECT id, auth_user_id, username, email, display_name, user_code, role,
                       preferred_language, is_active, created_at, last_login
                FROM public.nexo_profiles WHERE id = $1
            """, uid)
            if row:
                return {k: str(v) if k in ('id', 'auth_user_id') and v is not None
                        else v.isoformat() if isinstance(v, datetime) else v
                        for k, v in dict(row).items()}
            return None

    async def get_user_by_username(self, username: str) -> Optional[Dict[str, Any]]:
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT id, username, display_name, user_code, role FROM public.nexo_profiles WHERE username = $1",
                username
            )
            if row:
                return dict(row)
            return None

    # ================================================================
    # Conversations
    # ================================================================

    async def save_conversation(self, user_id: str, conversation_id: str,
                                 title: str, messages: List[Dict], model: str = None,
                                 agents: List[str] = None) -> Dict[str, Any]:
        import uuid
        uid = uuid.UUID(user_id)
        async with self._pool.acquire() as conn, conn.transaction():
            # Upsert: solo se actualiza si la conversación ya pertenece al mismo usuario
            row = await conn.fetchrow("""
                INSERT INTO public.nexo_conversations 
                    (user_id, conversation_id, title, model, agents, message_count)
                VALUES ($1, $2, $3, $4, $5, $6)
                ON CONFLICT (conversation_id) DO UPDATE SET
                    title = EXCLUDED.title, model = EXCLUDED.model,
                    agents = EXCLUDED.agents, message_count = EXCLUDED.message_count,
                    updated_at = NOW()
                WHERE nexo_conversations.user_id = EXCLUDED.user_id
                RETURNING id, conversation_id, title, created_at, updated_at
            """, uid, conversation_id, title, model, agents or [], len(messages))
            if row is None:
                raise PermissionError("La conversación pertenece a otro usuario")

            conv_id = row['id']

            # Reemplazar todos los mensajes de la conversación
            await conn.execute(
                "DELETE FROM public.nexo_messages WHERE conversation_id = $1", conv_id
            )
            await conn.executemany("""
                INSERT INTO public.nexo_messages 
                    (conversation_id, position, role, content, agent_id, model, metadata)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
            """, [(conv_id, i, str(msg.get('role', 'user'))[:20], msg.get('content', '') or '',
                   msg.get('agent_id'), msg.get('model'),
                   json.dumps(msg.get('metadata') or {}, default=str))
                  for i, msg in enumerate(messages)])

            return dict(row)

    async def get_conversations(self, user_id: str, limit: int = 50,
                                 offset: int = 0) -> List[Dict[str, Any]]:
        import uuid
        uid = uuid.UUID(user_id)
        async with self._pool.acquire() as conn:
            rows = await conn.fetch("""
                SELECT id, conversation_id, title, model, agents, message_count,
                       created_at, updated_at, is_archived, is_pinned
                FROM public.nexo_conversations
                WHERE user_id = $1 AND NOT is_archived
                ORDER BY is_pinned DESC, updated_at DESC
                LIMIT $2 OFFSET $3
            """, uid, limit, offset)
            return [dict(r) for r in rows]

    async def get_conversation(self, conversation_id: str, user_id: str) -> Optional[Dict[str, Any]]:
        """Devuelve la conversación solo si pertenece a user_id."""
        import uuid
        uid = uuid.UUID(user_id)
        async with self._pool.acquire() as conn:
            conv = await conn.fetchrow("""
                SELECT * FROM public.nexo_conversations
                WHERE conversation_id = $1 AND user_id = $2
            """, conversation_id, uid)
            if not conv:
                return None

            messages = await conn.fetch("""
                SELECT role, content, agent_id, model, created_at, metadata
                FROM public.nexo_messages
                WHERE conversation_id = $1
                ORDER BY position, created_at
            """, conv['id'])

            result = dict(conv)
            result['messages'] = [
                {**dict(m), 'metadata': json.loads(m['metadata']) if isinstance(m['metadata'], str) else m['metadata']}
                for m in messages
            ]
            return result

    async def delete_conversation(self, conversation_id: str, user_id: str) -> bool:
        import uuid
        uid = uuid.UUID(user_id)
        async with self._pool.acquire() as conn:
            result = await conn.execute(
                "DELETE FROM public.nexo_conversations WHERE conversation_id = $1 AND user_id = $2",
                conversation_id, uid
            )
            return "DELETE 1" in result

    # ================================================================
    # User Memory (persistent context)
    # ================================================================

    async def save_memory(self, user_id: str, key: str, value: str,
                          category: str = "general", importance: int = 5) -> Dict[str, Any]:
        import uuid
        uid = uuid.UUID(user_id)
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow("""
                INSERT INTO public.nexo_user_memory (user_id, key, value, category, importance)
                VALUES ($1, $2, $3, $4, $5)
                ON CONFLICT (user_id, key) DO UPDATE SET
                    value = EXCLUDED.value, category = EXCLUDED.category,
                    importance = EXCLUDED.importance, updated_at = NOW()
                RETURNING id, key, value, category, importance, created_at, updated_at
            """, uid, key, value, category, importance)
            return dict(row)

    async def get_memories(self, user_id: str, category: str = None,
                           limit: int = 100) -> List[Dict[str, Any]]:
        import uuid
        uid = uuid.UUID(user_id)
        async with self._pool.acquire() as conn:
            if category:
                rows = await conn.fetch("""
                    SELECT id, key, value, category, importance, created_at, updated_at
                    FROM public.nexo_user_memory
                    WHERE user_id = $1 AND category = $2
                    ORDER BY importance DESC, updated_at DESC
                    LIMIT $3
                """, uid, category, limit)
            else:
                rows = await conn.fetch("""
                    SELECT id, key, value, category, importance, created_at, updated_at
                    FROM public.nexo_user_memory
                    WHERE user_id = $1
                    ORDER BY importance DESC, updated_at DESC
                    LIMIT $2
                """, uid, limit)
            return [dict(r) for r in rows]

    async def delete_memory(self, user_id: str, key: str) -> bool:
        import uuid
        uid = uuid.UUID(user_id)
        async with self._pool.acquire() as conn:
            result = await conn.execute(
                "DELETE FROM public.nexo_user_memory WHERE user_id = $1 AND key = $2",
                uid, key
            )
            return "DELETE 1" in result

    async def get_memory_context(self, user_id: str) -> str:
        """Get all user memories as context string for AI prompts"""
        memories = await self.get_memories(user_id)
        if not memories:
            return ""
        lines = []
        for m in memories:
            lines.append(f"[{m['category']}] {m['key']}: {m['value']}")
        return "\n".join(lines)

    # ================================================================
    # User Preferences
    # ================================================================

    async def get_preferences(self, user_id: str) -> Dict[str, Any]:
        import uuid
        uid = uuid.UUID(user_id)
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT * FROM public.nexo_user_preferences WHERE user_id = $1", uid
            )
            if row:
                result = dict(row)
                # Don't expose password_hash in preferences
                if result.get('settings'):
                    settings = json.loads(result['settings']) if isinstance(result['settings'], str) else result['settings']
                    settings.pop('password_hash', None)
                    result['settings'] = settings
                return result
            return {}

    async def update_preferences(self, user_id: str, prefs: Dict[str, Any]) -> Dict[str, Any]:
        import uuid
        uid = uuid.UUID(user_id)
        async with self._pool.acquire() as conn:
            # Build dynamic update
            updates = []
            values = [uid]
            idx = 2
            allowed = ['theme', 'language', 'default_model', 'default_agents',
                        'auto_save_conversations', 'show_agent_thinking',
                        'notification_enabled', 'custom_instructions']
            for key in allowed:
                if key in prefs:
                    updates.append(f"{key} = ${idx}")
                    values.append(prefs[key])
                    idx += 1

            if not updates:
                return await self.get_preferences(user_id)

            query = f"""
                UPDATE public.nexo_user_preferences
                SET {', '.join(updates)}
                WHERE user_id = $1
                RETURNING *
            """
            row = await conn.fetchrow(query, *values)
            return dict(row) if row else {}

    # ================================================================
    # Usage Tracking
    # ================================================================

    async def track_usage(self, user_id: str, tokens: int = 0,
                          agent_id: str = None, model: str = None):
        import uuid
        uid = uuid.UUID(user_id)
        current_month = datetime.now().strftime("%Y-%m")
        async with self._pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO public.nexo_usage (user_id, month, queries_used, tokens_consumed)
                VALUES ($1, $2, 1, $3)
                ON CONFLICT (user_id, month) DO UPDATE SET
                    queries_used = nexo_usage.queries_used + 1,
                    tokens_consumed = nexo_usage.tokens_consumed + $3,
                    last_activity = NOW()
            """, uid, current_month, tokens)

            # Update agents_used if provided
            if agent_id:
                await conn.execute("""
                    UPDATE public.nexo_usage
                    SET agents_used = array_append(
                        CASE WHEN $3 = ANY(agents_used) THEN agents_used
                        ELSE agents_used END, $3)
                    WHERE user_id = $1 AND month = $2
                    AND NOT ($3 = ANY(agents_used))
                """, uid, current_month, agent_id)

    async def get_usage(self, user_id: str) -> Dict[str, Any]:
        import uuid
        uid = uuid.UUID(user_id)
        current_month = datetime.now().strftime("%Y-%m")
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow("""
                SELECT u.queries_used, u.tokens_consumed, u.agents_used, u.models_used,
                       s.plan, s.monthly_queries, s.max_agents
                FROM public.nexo_usage u
                LEFT JOIN public.nexo_subscriptions s ON s.user_id = u.user_id
                WHERE u.user_id = $1 AND u.month = $2
            """, uid, current_month)

            if row:
                return {
                    "queries_used": row['queries_used'],
                    "queries_limit": row['monthly_queries'] or 50,
                    "queries_remaining": max(0, (row['monthly_queries'] or 50) - row['queries_used']),
                    "tokens_consumed": row['tokens_consumed'],
                    "plan": row['plan'],
                    "max_agents": row['max_agents'],
                }
            return {
                "queries_used": 0, "queries_limit": 50,
                "queries_remaining": 50, "plan": "free", "max_agents": 10,
            }

    # ================================================================
    # Stats (admin)
    # ================================================================

    async def get_stats(self) -> Dict[str, Any]:
        async with self._pool.acquire() as conn:
            users = await conn.fetchval("SELECT COUNT(*) FROM public.nexo_profiles")
            convs = await conn.fetchval("SELECT COUNT(*) FROM public.nexo_conversations")
            msgs = await conn.fetchval("SELECT COUNT(*) FROM public.nexo_messages")
            memories = await conn.fetchval("SELECT COUNT(*) FROM public.nexo_user_memory")

            return {
                "total_users": users,
                "total_conversations": convs,
                "total_messages": msgs,
                "total_memories": memories,
            }


# Singleton instance
pg_db = PgDatabase.get_instance()
