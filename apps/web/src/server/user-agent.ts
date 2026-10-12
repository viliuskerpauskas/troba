// A short, human label for a session's device ("Firefox on Windows"), enough to tell sessions
// apart in account settings. Order matters: Edge and Opera also say Chrome, and Chrome says Safari.
const browsers: [name: string, pattern: RegExp][] = [
  ["Edge", /\bEdg(e|A|iOS)?\//],
  ["Opera", /\bOPR\//],
  ["Firefox", /\b(Firefox|FxiOS)\//],
  ["Chrome", /\b(Chrome|CriOS)\//],
  ["Safari", /\bVersion\/[\d.]+.*\bSafari\//],
];

const systems: [name: string, pattern: RegExp][] = [
  ["iPhone", /\biPhone\b/],
  ["iPad", /\biPad\b/],
  ["Android", /\bAndroid\b/],
  ["Windows", /\bWindows\b/],
  ["macOS", /\bMacintosh\b/],
  ["Linux", /\bLinux\b/],
];

function firstMatch(list: [string, RegExp][], userAgent: string) {
  return list.find(([, pattern]) => pattern.test(userAgent))?.[0];
}

export function describeDevice(userAgent: string | null | undefined): string {
  if (!userAgent) return "Unknown device";
  const browser = firstMatch(browsers, userAgent);
  if (!browser) return "Unknown device";
  const system = firstMatch(systems, userAgent);
  return system ? `${browser} on ${system}` : browser;
}
