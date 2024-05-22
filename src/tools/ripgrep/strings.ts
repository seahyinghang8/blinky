/**
 * Escapes regular expression characters in a given string
 */
export function escapeRegExpCharacters(value: string): string {
  return value.replace(/[\\\{\}\*\+\?\|\^\$\.\[\]\(\)]/g, '\\$&');
}

export interface RegExpOptions {
  matchCase?: boolean;
  wholeWord?: boolean;
  multiline?: boolean;
  global?: boolean;
  unicode?: boolean;
}

export function createRegExp(
  searchString: string,
  isRegex: boolean,
  options: RegExpOptions = {}
): RegExp {
  if (!searchString) {
    throw new Error('Cannot create regex from empty string');
  }
  if (!isRegex) {
    searchString = escapeRegExpCharacters(searchString);
  }
  if (options.wholeWord) {
    if (!/\B/.test(searchString.charAt(0))) {
      searchString = '\\b' + searchString;
    }
    if (!/\B/.test(searchString.charAt(searchString.length - 1))) {
      searchString = searchString + '\\b';
    }
  }
  let modifiers = '';
  if (options.global) {
    modifiers += 'g';
  }
  if (!options.matchCase) {
    modifiers += 'i';
  }
  if (options.multiline) {
    modifiers += 'm';
  }
  if (options.unicode) {
    modifiers += 'u';
  }

  return new RegExp(searchString, modifiers);
}

export function getNLines(str: string, n = 1): string {
  if (n === 0) {
    return '';
  }

  let idx = -1;
  do {
    idx = str.indexOf('\n', idx + 1);
    n--;
  } while (n > 0 && idx >= 0);

  if (idx === -1) {
    return str;
  }

  if (str[idx - 1] === '\r') {
    idx--;
  }

  return str.substring(0, idx);
}
