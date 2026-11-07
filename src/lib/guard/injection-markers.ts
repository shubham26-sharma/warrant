export const INJECTION_MARKERS: readonly RegExp[] = [
  /\bignore\s+(?:the\s+)?mandate\b/i,
  /\bignore\s+(?:all\s+)?previous\b/i,
  /\bsystem\s+override\b/i,
  /\bsystem\s+prompt\b/i,
  /\bbypass\b/i,
  /\bapprove\s+(?:this|the)\b/i,
  /\/api\//i,
  /\bchange\s+mandate\b/i,
];

export function findInjectionMarkers(text: string): string[] {
  return INJECTION_MARKERS.flatMap((pattern) => {
    const match = text.match(pattern);
    return match ? [match[0]] : [];
  });
}
