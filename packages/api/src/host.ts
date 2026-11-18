const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1']);

/** The host name in a `Host` header or a bind address: lowercased, without its port or IPv6 brackets. */
export function hostnameOf(host: string): string {
  const name = host.trim().toLowerCase();
  if (name.startsWith('[')) {
    const end = name.indexOf(']');
    return end === -1 ? name : name.slice(1, end);
  }
  // `name:port` has one colon; a bare IPv6 address has several and no port.
  const parts = name.split(':');
  return parts.length === 2 ? (parts[0] as string) : name;
}

/**
 * True when a request's `Host` names this machine: a loopback name, or the host the server was bound to. A web page
 * that rebinds its own domain to 127.0.0.1 still sends that domain, so it is refused.
 */
export function isAllowedHost(host: string, bound?: string): boolean {
  const name = hostnameOf(host);
  return LOOPBACK.has(name) || (bound !== undefined && bound !== '' && name === hostnameOf(bound));
}
