import { CancellationTokenSource, Position, Range, Uri } from 'vscode';
import { RipgrepTextSearchEngine } from './ripgrepTextSearchEngine';
import { TextSearchResult } from './searchTypes';

const DEFAULT_TIMEOUT_MS = 3000;
const MAX_RESULTS = 10000;

// This match will coalesce contiguous lines into one range
export interface ISearchMatch {
  range: Range;
  text: string;
  uri: Uri;
}

export interface ISearchResults {
  matches: ISearchMatch[];
}

export async function ripgrepSearch(
  query: string,
  cwd: Uri,
  options?: {
    excludes?: string[];
    excludeGitignore?: boolean;
    timeout?: number;
    maxResults?: number;
    beforeContext?: number;
    afterContext?: number;
  }
): Promise<ISearchResults> {
  // ignore the output logger for now
  const rgEngine = new RipgrepTextSearchEngine({ appendLine: () => {} });

  const excludes = options?.excludes ?? [];
  const excludeGitignore = options?.excludeGitignore ?? true;
  const timeout = options?.timeout ?? DEFAULT_TIMEOUT_MS;
  const maxResults = options?.maxResults ?? MAX_RESULTS;

  const tokenSource = new CancellationTokenSource();

  setTimeout(() => {
    tokenSource.cancel();
  }, timeout);

  const matches: ISearchMatch[] = [];
  let currentMatch: ISearchMatch | null = null;

  const progress = {
    report: (value: TextSearchResult) => {
      let lineNum;
      let text;
      let uri;

      if ('preview' in value) {
        // value is TextSearchMatch
        uri = value.uri;
        text = value.preview.text;
        if ('start' in value.ranges) {
          lineNum = value.ranges.start.line;
        } else {
          lineNum = value.ranges[0].start.line;
        }
      } else {
        // value is TextSearchContext
        uri = value.uri;
        text = value.text + '\n';
        // converting from user line num to internal line num
        lineNum = value.lineNumber - 1;
      }

      if (
        !currentMatch ||
        currentMatch.uri.fsPath !== uri.fsPath ||
        currentMatch.range.end.line !== lineNum
      ) {
        if (currentMatch) {
          matches.push(currentMatch);
        }
        // Create a new current match
        currentMatch = {
          range: new Range(lineNum, 0, lineNum + 1, 0),
          text,
          uri,
        };
      } else {
        currentMatch = {
          range: currentMatch.range.with({ end: new Position(lineNum + 1, 0) }),
          text: currentMatch.text + text,
          uri,
        };
      }
    },
  };

  await rgEngine.provideTextSearchResults(
    { pattern: query },
    {
      maxResults: maxResults,
      folder: cwd,
      includes: [],
      excludes: excludes,
      useIgnoreFiles: excludeGitignore,
      useGlobalIgnoreFiles: excludeGitignore,
      useParentIgnoreFiles: excludeGitignore,
      followSymlinks: true,
      beforeContext: options?.beforeContext,
      afterContext: options?.afterContext,
    },
    progress,
    tokenSource.token
  );

  if (currentMatch) {
    matches.push(currentMatch);
  }

  tokenSource.dispose();

  return { matches };
}
