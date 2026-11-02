/** 幂等集合按 RFC 9110 §9.2.2；方法名大小写不敏感，未知方法按非幂等。 */
const IDEMPOTENT = new Set(['GET', 'HEAD', 'OPTIONS', 'TRACE', 'PUT', 'DELETE']);

export function isIdempotent(method) {
  return IDEMPOTENT.has(String(method || '').toUpperCase());
}

/**
 * 连接已建立（请求体可能已交给网关）之后失败时，是否允许换路重放。
 * sent=false 时请求体一定没交出去，任何方法都可以重放。
 */
export function shouldRetryAfterSend({ method, sent, retryNonIdempotentAfterSend = false }) {
  if (!sent) return true;
  if (isIdempotent(method)) return true;
  return Boolean(retryNonIdempotentAfterSend);
}
