import redis
import json
import logging
from config import settings

logger = logging.getLogger(__name__)

_memory_store = {}

try:
    redis_client = redis.Redis.from_url(settings.REDIS_URL, decode_responses=True)
except Exception as e:
    logger.warning(f"Redis initialization warning: {e}")
    redis_client = None

def set_cache(key: str, value, ttl: int = 300):
    try:
        val_str = json.dumps(value) if isinstance(value, (dict, list)) else str(value)
        if redis_client:
            redis_client.setex(key, ttl, val_str)
        else:
            _memory_store[key] = val_str
    except Exception as e:
        logger.error(f"Error setting cache for key {key}: {e}")
        _memory_store[key] = json.dumps(value) if isinstance(value, (dict, list)) else str(value)

def get_cache(key: str):
    try:
        data = None
        if redis_client:
            data = redis_client.get(key)
        else:
            data = _memory_store.get(key)
            
        if data:
            try:
                return json.loads(data)
            except Exception:
                return data
        return None
    except Exception as e:
        logger.error(f"Error getting cache for key {key}: {e}")
        data = _memory_store.get(key)
        if data:
            try:
                return json.loads(data)
            except Exception:
                return data
        return None

def delete_cache(key: str):
    try:
        if redis_client:
            redis_client.delete(key)
        _memory_store.pop(key, None)
    except Exception as e:
        logger.error(f"Error deleting cache for key {key}: {e}")
        _memory_store.pop(key, None)
