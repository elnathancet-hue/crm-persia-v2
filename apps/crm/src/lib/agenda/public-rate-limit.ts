// Rate-limit em memoria para o booking publico.
//
// MVP: limita por IP (best-effort) sem persistir em DB. Vantagem: zero
// migration nova, zero infra extra. Desvantagem: state perde a cada
// restart do servidor (Easypanel reinicia em deploy = OK pra trafego
// inicial). Quando crescer, migrar pra tabela `public_booking_rate_limits`
// (key: ip_hash + org_id + action) com SECURITY DEFINER function similar
// a consume_rate_limit (migration 015).
//
// Limites default conservadores:
//   - 8 submits / 5 min por IP (cobre lead reagendando + erro de digito)
//   - 30 GETs/slot-fetch por minuto (UI muda data, busca slots)

interface Bucket {
  count: number;
  resetAt: number;
}

const SUBMIT_BUCKETS = new Map<string, Bucket>();
const SLOTS_BUCKETS = new Map<string, Bucket>();

const SUBMIT_MAX = 8;
const SUBMIT_WINDOW_MS = 5 * 60 * 1000;
const SLOTS_MAX = 30;
const SLOTS_WINDOW_MS = 60 * 1000;

// Cleanup oportunistico — chamado a cada check, mantem o map enxuto.
function cleanup(map: Map<string, Bucket>, now: number) {
  if (map.size < 1000) return;
  for (const [k, v] of map) {
    if (v.resetAt < now) map.delete(k);
  }
}

function check(
  map: Map<string, Bucket>,
  key: string,
  max: number,
  windowMs: number,
): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  cleanup(map, now);
  const bucket = map.get(key);
  if (!bucket || bucket.resetAt < now) {
    map.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSeconds: 0 };
  }
  if (bucket.count >= max) {
    return {
      allowed: false,
      retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000),
    };
  }
  bucket.count++;
  return { allowed: true, retryAfterSeconds: 0 };
}

export function checkSubmitRateLimit(ip: string) {
  return check(SUBMIT_BUCKETS, ip, SUBMIT_MAX, SUBMIT_WINDOW_MS);
}

export function checkSlotsRateLimit(ip: string) {
  return check(SLOTS_BUCKETS, ip, SLOTS_MAX, SLOTS_WINDOW_MS);
}

/**
 * Resolve IP do request via headers do Next 15. Em prod (atras do
 * EasyPanel/Cloudflare) chega em x-forwarded-for; em dev cai no request.
 * Defensivo: nunca lanca, sempre retorna string.
 */
export function getClientIp(headers: Headers): string {
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  return "unknown";
}
