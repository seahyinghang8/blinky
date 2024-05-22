import { CancellationError, Uri } from 'vscode';
import { mapArrayOrNot } from './array';
import { getNLines } from './strings';

// Warning: this pattern is used in the search editor to detect offsets. If you
// change this, also change the search-result built-in extension
const SEARCH_ELIDED_PREFIX = '⟪ ';
const SEARCH_ELIDED_SUFFIX = ' characters skipped ⟫';
const SEARCH_ELIDED_MIN_LEN =
  (SEARCH_ELIDED_PREFIX.length + SEARCH_ELIDED_SUFFIX.length + 5) * 2;

const canceledName = 'Canceled';
/**
 * Checks if the given error is a promise in canceled state
 */
export function isCancellationError(error: any): boolean {
  if (error instanceof CancellationError) {
    return true;
  }
  return (
    error instanceof Error &&
    error.name === canceledName &&
    error.message === canceledName
  );
}

export enum SearchErrorCode {
  unknownEncoding = 1,
  regexParseError,
  globParseError,
  invalidLiteral,
  rgProcessError,
  other,
  canceled,
}

export class SearchError extends Error {
  constructor(message: string, readonly code?: SearchErrorCode) {
    super(message);
  }
}

export function deserializeSearchError(error: Error): SearchError {
  const errorMsg = error.message;

  if (isCancellationError(error)) {
    return new SearchError(errorMsg, SearchErrorCode.canceled);
  }

  try {
    const details = JSON.parse(errorMsg);
    return new SearchError(details.message, details.code);
  } catch (e) {
    return new SearchError(errorMsg, SearchErrorCode.other);
  }
}

export function serializeSearchError(searchError: SearchError): Error {
  const details = { message: searchError.message, code: searchError.code };
  return new Error(JSON.stringify(details));
}

export interface ISearchRange {
  readonly startLineNumber: number;
  readonly startColumn: number;
  readonly endLineNumber: number;
  readonly endColumn: number;
}

export class SearchRange implements ISearchRange {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;

  constructor(
    startLineNumber: number,
    startColumn: number,
    endLineNumber: number,
    endColumn: number
  ) {
    this.startLineNumber = startLineNumber;
    this.startColumn = startColumn;
    this.endLineNumber = endLineNumber;
    this.endColumn = endColumn;
  }
}

function isSingleLineRangeList(ranges: ISearchRange[]): boolean {
  const line = ranges[0].startLineNumber;
  for (const r of ranges) {
    if (r.startLineNumber !== line || r.endLineNumber !== line) {
      return false;
    }
  }

  return true;
}

export class OneLineRange extends SearchRange {
  constructor(lineNumber: number, startColumn: number, endColumn: number) {
    super(lineNumber, startColumn, lineNumber, endColumn);
  }
}

export interface ITextSearchResultPreview {
  text: string;
  matches: ISearchRange | ISearchRange[];
  cellFragment?: string;
}

export interface ITextSearchMatch {
  uri?: Uri;
  ranges: ISearchRange | ISearchRange[];
  preview: ITextSearchResultPreview;
  webviewIndex?: number;
}

export interface ITextSearchPreviewOptions {
  matchLines: number;
  charsPerLine: number;
}

export class TextSearchMatch implements ITextSearchMatch {
  ranges: ISearchRange | ISearchRange[];
  preview: ITextSearchResultPreview;
  webviewIndex?: number;

  constructor(
    text: string,
    range: ISearchRange | ISearchRange[],
    previewOptions?: ITextSearchPreviewOptions,
    webviewIndex?: number
  ) {
    this.ranges = range;
    this.webviewIndex = webviewIndex;

    // Trim preview if this is one match and a single-line match with a preview requested.
    // Otherwise send the full text, like for replace or for showing multiple previews.
    // TODO this is fishy.
    const ranges = Array.isArray(range) ? range : [range];
    if (
      previewOptions &&
      previewOptions.matchLines === 1 &&
      isSingleLineRangeList(ranges)
    ) {
      // 1 line preview requested
      text = getNLines(text, previewOptions.matchLines);

      let result = '';
      let shift = 0;
      let lastEnd = 0;
      const leadingChars = Math.floor(previewOptions.charsPerLine / 5);
      const matches: ISearchRange[] = [];
      for (const range of ranges) {
        const previewStart = Math.max(range.startColumn - leadingChars, 0);
        const previewEnd = range.startColumn + previewOptions.charsPerLine;
        if (previewStart > lastEnd + leadingChars + SEARCH_ELIDED_MIN_LEN) {
          const elision =
            SEARCH_ELIDED_PREFIX +
            (previewStart - lastEnd) +
            SEARCH_ELIDED_SUFFIX;
          result += elision + text.slice(previewStart, previewEnd);
          shift += previewStart - (lastEnd + elision.length);
        } else {
          result += text.slice(lastEnd, previewEnd);
        }

        matches.push(
          new OneLineRange(
            0,
            range.startColumn - shift,
            range.endColumn - shift
          )
        );
        lastEnd = previewEnd;
      }

      this.preview = {
        text: result,
        matches: Array.isArray(this.ranges) ? matches : matches[0],
      };
    } else {
      const firstMatchLine = Array.isArray(range)
        ? range[0].startLineNumber
        : range.startLineNumber;

      this.preview = {
        text,
        matches: mapArrayOrNot(
          range,
          (r) =>
            new SearchRange(
              r.startLineNumber - firstMatchLine,
              r.startColumn,
              r.endLineNumber - firstMatchLine,
              r.endColumn
            )
        ),
      };
    }
  }
}
