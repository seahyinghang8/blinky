import { Uri, Range } from 'vscode';
import {
  TextSearchMatch as TextSearchMatchType,
  TextSearchPreviewOptions,
} from './searchTypes';
import { mapArrayOrNot } from './array';
import { SearchRange, TextSearchMatch } from './commonSearch';

export function anchorGlob(glob: string): string {
  return glob.startsWith('**') || glob.startsWith('/') ? glob : `/${glob}`;
}

/**
 * Create a vscode.TextSearchMatch by using our internal TextSearchMatch type for its previewOptions logic.
 */
export function createTextSearchResult(
  uri: Uri,
  text: string,
  range: Range | Range[],
  previewOptions?: TextSearchPreviewOptions
): TextSearchMatchType {
  const searchRange = mapArrayOrNot(range, rangeToSearchRange);
  const internalResult = new TextSearchMatch(text, searchRange, previewOptions);
  const internalPreviewRange = internalResult.preview.matches;
  return {
    ranges: mapArrayOrNot(searchRange, searchRangeToRange),
    uri,
    preview: {
      text: internalResult.preview.text,
      matches: mapArrayOrNot(internalPreviewRange, searchRangeToRange),
    },
  };
}

function rangeToSearchRange(range: Range): SearchRange {
  return new SearchRange(
    range.start.line,
    range.start.character,
    range.end.line,
    range.end.character
  );
}

function searchRangeToRange(range: SearchRange): Range {
  return new Range(
    range.startLineNumber,
    range.startColumn,
    range.endLineNumber,
    range.endColumn
  );
}

export interface IOutputChannel {
  appendLine(msg: string): void;
}
