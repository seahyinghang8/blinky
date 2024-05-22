export function splitGlobAware(pattern: string, splitChar: string): string[] {
  if (!pattern) {
    return [];
  }

  const segments: string[] = [];

  let inBraces = false;
  let inBrackets = false;

  let curVal = '';
  for (const char of pattern) {
    switch (char) {
      case splitChar:
        if (!inBraces && !inBrackets) {
          segments.push(curVal);
          curVal = '';

          continue;
        }
        break;
      case '{':
        inBraces = true;
        break;
      case '}':
        inBraces = false;
        break;
      case '[':
        inBrackets = true;
        break;
      case ']':
        inBrackets = false;
        break;
    }

    curVal += char;
  }

  // Tail
  if (curVal) {
    segments.push(curVal);
  }

  return segments;
}
