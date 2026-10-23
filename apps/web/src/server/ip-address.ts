import { isIPv6 } from "node:net";

// A session's IP address as the sessions list shows it (SPEC-identity I4). Better Auth stores an
// IPv6 address as its /64, written out in full with the rest zeroed, so it's shown as that
// network; the URL parser writes it in its shortest form. An empty address means Better Auth
// couldn't tell.
export function describeIpAddress(ipAddress: string | null): string | null {
  if (!ipAddress) return null;
  if (!isIPv6(ipAddress)) return ipAddress;
  return `${new URL(`http://[${ipAddress}]`).hostname.slice(1, -1)}/64`;
}
