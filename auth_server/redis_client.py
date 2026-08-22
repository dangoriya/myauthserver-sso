import redis
import json
from config import settings

redis_client = redis.Redis.from_url(settings.REDIS_URL, decode_responses=True)

def set_cache(key: str, value: dict, ttl: int = 300):
    redis_client.setex(key, ttl, json.dumps(value))

def get_cache(key: str):
    data = redis_client.get(key)
    if data:
        return json.loads(data)
    return None

def delete_cache(key: str):
    redis_client.delete(key)
