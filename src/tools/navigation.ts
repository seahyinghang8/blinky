import {
  workspace,
  Uri,
  commands,
  DocumentSymbol,
  SymbolKind,
  TextDocument,
  Location,
  LocationLink,
  SymbolInformation,
  RelativePattern,
  FileType,
} from 'vscode';
import { parseIgnoreFile } from './ignoreFile';
import path from 'path';
import {
  getPositionFromLineNumAndText,
  getRootUri,
  getTextFromLines,
  internalToUserLineNum,
  parseLineNumbers,
  pathToURI,
  preProcessGlobPath,
  prependLineNumbers,
  userToInternalLineNum,
} from './utils';
import { ISearchMatch, ISearchResults, ripgrepSearch } from './ripgrep';

// Tools for code navigation
const EXPANDSTRING = '...';

// VSCode internal lines is 0-indexed while users see 1-indexed
export async function readFile(
  filename: string,
  startLineNum?: string,
  endLineNum?: string,
  maxLines: number = 100
): Promise<{ observation: string; failed: boolean }> {
  const fileUri = pathToURI(filename);
  let document: TextDocument;
  try {
    document = await workspace.openTextDocument(fileUri);
  } catch (e) {
    return {
      observation: `Could not open file '${fileUri.path}'. Make sure the file exists by searching with FindFiles.`,
      failed: true,
    };
  }

  // If the file is too long, only show symbols
  if (!startLineNum && !endLineNum && document.lineCount > maxLines) {
    const symbols = (await getFileSymbols(filename)).observation;
    if (symbols.split('\n').length < 2) {
      return {
        observation: `The file '${fileUri.path}' is too long to display. Use FindTextInFiles to search for exactly what you are looking or use the startLineNum & endLineNum parameters to read a subset.`,
        failed: true,
      };
    }
  }

  const startLine = !!startLineNum
    ? userToInternalLineNum(parseLineNumbers(startLineNum))
    : userToInternalLineNum(1);
  const endLine = !!endLineNum
    ? userToInternalLineNum(parseLineNumbers(endLineNum))
    : userToInternalLineNum(document.lineCount);
  const text = getTextFromLines(document, startLine, endLine);
  const textWithLineNumbers = prependLineNumbers(
    text,
    internalToUserLineNum(startLine)
  );
  return {
    observation: textWithLineNumbers,
    failed: false,
  };
}

export async function getFileSymbols(
  filename: string
): Promise<{ observation: string; failed: boolean }> {
  const fileUri = pathToURI(filename);
  const symbols: (DocumentSymbol | SymbolInformation)[] | undefined =
    await commands.executeCommand(
      'vscode.executeDocumentSymbolProvider',
      fileUri
    );
  if (!symbols) {
    return {
      observation: `There are no symbols for '${fileUri.path}'.`,
      failed: true,
    };
  }
  const symbolsText = await Promise.all(
    symbols.map(async (sym) => symbolToString(sym))
  );
  const symbolsTextCombined = symbolsText.join('\n\n');
  return {
    observation: symbolsTextCombined,
    failed: false,
  };
}

export async function goToDefinition(
  filename: string,
  lineNum: string,
  matchingText: string
): Promise<{ observation: string; failed: boolean }> {
  const fileUri = pathToURI(filename);
  const document = await workspace.openTextDocument(fileUri);
  const position = await getPositionFromLineNumAndText(
    document,
    lineNum,
    matchingText
  );
  const locations: (Location | LocationLink)[] = await commands.executeCommand(
    'vscode.executeDefinitionProvider',
    fileUri,
    position
  );
  const codeChunks = await Promise.all(locations.map(locationToCodeChunk));
  const codeChunksCombined = codeChunks.join('\n\n');
  return {
    observation: codeChunksCombined,
    failed: false,
  };
}

export async function getAllReferences(
  filename: string,
  lineNum: string,
  matchingText: string,
  subDirectory?: string,
  maxResults: number = 50
): Promise<{ observation: string; failed: boolean }> {
  const fileUri = pathToURI(filename);
  const document = await workspace.openTextDocument(fileUri);
  const position = await getPositionFromLineNumAndText(
    document,
    lineNum,
    matchingText
  );
  let locations: Location[] = await commands.executeCommand(
    'vscode.executeReferenceProvider',
    fileUri,
    position
  );
  if (subDirectory) {
    locations = locations.filter((loc) => loc.uri.path.includes(subDirectory));
  }
  if (locations.length > maxResults) {
    return {
      observation:
        'Too many references found. Use the subDirectory parameter to search within a more constrained folder/file.',
      failed: true,
    };
  }
  const codeChunks = await Promise.all(locations.map(locationToCodeChunk));
  const codeChunksCombined = codeChunks.join('\n\n');
  return {
    observation: codeChunksCombined,
    failed: false,
  };
}

export async function searchCodeSymbol(
  query: string
): Promise<{ observation: string; failed: boolean }> {
  const symbols: SymbolInformation[] = await commands.executeCommand(
    'vscode.executeWorkspaceSymbolProvider',
    query
  );
  const symbolsText = await Promise.all(
    symbols.map(async (sym) => symbolToString(sym, true, true))
  );
  const symbolsTextCombined = symbolsText.join('\n\n');
  return {
    observation: symbolsTextCombined,
    failed: false,
  };
}

export async function listDirectory(
  directoryPath: string = './'
): Promise<{ observation: string; failed: boolean }> {
  const baseUri = pathToURI(directoryPath, true);

  const entries = await workspace.fs.readDirectory(baseUri);
  const entriesStr = entries
    .map((value) => {
      const [filename, fileType] = value;
      let trailingStr = '';
      switch (fileType) {
        case FileType.Directory:
          trailingStr = '/';
          break;
        case FileType.SymbolicLink:
          trailingStr = ' (symlink)';
          break;
      }
      return `${filename}${trailingStr}`;
    })
    .join('\n');

  const output = `${entries.length} entry(s) in '${baseUri.path}'\n${entriesStr}`;

  return {
    observation: output,
    failed: false,
  };
}

const MAX_RESULTS = 10000;

// Only work for directoryPath within the workspace
export async function listDirectoryRecursive(
  directoryPath: string = './',
  excludeGitignore: boolean = true,
  maxFiles: number = 50
): Promise<{ observation: string; failed: boolean }> {
  let excludeGlob = getStandardExcludeGlob();

  const rootUri = getRootUri();
  const baseUri = pathToURI(directoryPath, true);
  let relativePath = preProcessGlobPath(
    baseUri.path.substring(rootUri.path.length)
  );
  let includeGlob = ['*', '*/**']; // because ** doesn't work in {**}
  if (relativePath.length > 0) {
    includeGlob = includeGlob.map((glob) => `${relativePath}${glob}`);
  }

  if (excludeGitignore) {
    const gitignoreGlobs = await getGitignoreGlob(
      baseUri,
      rootUri,
      excludeGlob
    );
    includeGlob = includeGlob.concat(gitignoreGlobs.includeGlob);
    // remove "**" and "**/*" from excludeGlob because it's too aggressive and might exclude everything
    // temp fix till we figure out whats going on in parser
    gitignoreGlobs.excludeGlob = gitignoreGlobs.excludeGlob.filter(
      (glob) => glob !== '**' && glob !== '**/*'
    );
    excludeGlob = excludeGlob.concat(gitignoreGlobs.excludeGlob).concat(['.*']);
  }

  const matches = await workspace.findFiles(
    `{${includeGlob.join(',')}}`,
    `{${excludeGlob.join(',')}}`,
    MAX_RESULTS
  );
  const relativePathMatches = matches.map((uri) =>
    uri.path.substring(baseUri.path.length)
  );
  const groupedFiles = groupByDirectory(relativePathMatches);
  const sortedGroupFiles = sortGroupFiles(groupedFiles, true);
  filterFiles(sortedGroupFiles, maxFiles);
  const filesStr = stringifyGroupedFiles(sortedGroupFiles);
  const output = `${matches.length} file(s) in '${baseUri.path}'\n${filesStr}`;

  if (matches.length === 0) {
    return {
      observation: output,
      failed: true,
    };
  }
  return {
    observation: output,
    failed: false,
  };
}

async function _findFilesHelper(
  query: string,
  excludeGitignore: boolean = true,
  maxResults: number = MAX_RESULTS
): Promise<string[]> {
  const includeGlob = [`**/*${query}*/*`, `**/*${query}*`];
  let excludeGlob = getStandardExcludeGlob();
  const rootUri = getRootUri();

  if (excludeGitignore) {
    const gitignoreGlobs = await getGitignoreGlob(
      rootUri,
      rootUri,
      excludeGlob
    );
    // TODO: gitignore include glob is unused but it should be utilized somehow in the future
    // remove "**" and "**/*" from excludeGlob because it's too aggressive and might exclude everything
    // temp fix till we figure out whats going on in parser
    gitignoreGlobs.excludeGlob = gitignoreGlobs.excludeGlob.filter(
      (glob) => glob !== '**' && glob !== '**/*'
    );
    excludeGlob = excludeGlob.concat(gitignoreGlobs.excludeGlob);
  }

  const matches = await workspace.findFiles(
    `{${includeGlob.join(',')}}`,
    `{${excludeGlob.join(',')}}`,
    maxResults
  );
  return matches.map((uri) => uri.path.substring(rootUri.path.length));
}

function insensitiveGlob(pattern: string): string {
  function either(c: string): string {
    return /[a-zA-Z]/.test(c) ? `[${c.toLowerCase()}${c.toUpperCase()}]` : c;
  }

  const caseInsensitivePattern = pattern.split('').map(either).join('');
  return caseInsensitivePattern;
}

export async function findFiles(
  query: string,
  excludeGitignore: boolean = true,
  maxResults: number = MAX_RESULTS
): Promise<{ observation: string; failed: boolean }> {
  const relativePathMatches = await _findFilesHelper(
    insensitiveGlob(query),
    excludeGitignore,
    maxResults
  );
  const groupedFiles = groupByDirectory(relativePathMatches);
  const sortedGroupFiles = sortGroupFiles(groupedFiles, true);
  const filesStr = stringifyGroupedFiles(sortedGroupFiles);
  const output = `${relativePathMatches.length} file(s) that matches query '${query}'\n${filesStr}`;
  if (relativePathMatches.length === 0) {
    return {
      observation: output,
      failed: true,
    };
  }
  return {
    observation: output,
    failed: false,
  };
}

export async function ripGrepHelper(
  query: string,
  subdir: string = '',
  excludeGitignore: boolean = true
): Promise<ISearchMatch[]> {
  const excludeGlob = getStandardExcludeGlob();
  const rootUri = getRootUri();

  let { matches } = await ripgrepSearch(query, rootUri, {
    excludes: excludeGlob,
    excludeGitignore,
    beforeContext: 1,
    afterContext: 1,
  });
  if (subdir.length > 0) {
    matches = matches.filter(({ uri }) => uri.path.includes(subdir));
  }
  return matches;
}

function matchToStr(
  text: string,
  uri: Uri,
  range: {
    start: { line: number };
    end: { line: number };
    isSingleLine: boolean;
  }
): string {
  // Remove the trailing newline if it exists
  if (text.endsWith('\n')) {
    text = text.substring(0, text.length - 1);
  }
  // Get line numbers in user's format
  const userStartLine = internalToUserLineNum(range.start.line);
  // Convert end line to be inclusive instead of exclusive
  const userEndLine = internalToUserLineNum(range.end.line - 1);
  const rangeText = range.isSingleLine
    ? `${userStartLine}`
    : `${userStartLine}-${userEndLine}`;
  const textChunkWithLineNum = prependLineNumbers(text, userStartLine);
  return `${uri.path}:${rangeText}\n${textChunkWithLineNum}`;
}

export async function findTextInFiles(
  query: string,
  subdir: string = '',
  excludeGitignore: boolean = true,
  maxResults: number = 15
): Promise<{ observation: string; failed: boolean }> {
  const matches = await ripGrepHelper(query, subdir, excludeGitignore);
  if (matches.length > maxResults) {
    return {
      observation: `Too many results (${matches.length}) to display. Please refine your search.`,
      failed: true,
    };
  }
  if (matches.length === 0) {
    return {
      observation: `No matches found for query '${query}'.`,
      failed: true,
    };
  }
  const matchStr = matches.map(({ text, uri, range }) =>
    matchToStr(text, uri, range)
  );

  const output = matchStr.join('\n\n');
  return {
    observation: output,
    failed: false,
  };
}

export async function getFilesRelevantToEndpoint(
  endpoint: string,
  maxQueries: number = 3,
  maxResultsPerQuery: number = 5
): Promise<{ observation: string; failed: boolean }> {
  let files: string[] = [];
  let textMatches: string[] = [];
  let currentQueries = 0;
  let curMaxParts: number | null = null;

  const parts = endpoint.split('/');
  let filePermutations: string[] = [];
  let textPermutations: string[] = [];

  for (let i = 0; i < parts.length; i++) {
    for (let j = i + 1; j <= parts.length; j++) {
      const curParts = parts.slice(i, j);
      for (let k = 0; k < curParts.length; k++) {
        const numDigits = curParts[k].replace(/[^0-9]/g, '').length;
        const numPuncts = curParts[k].replace(/[:(){}\[\]]/g, '').length;
        if (
          curParts[k].length > 10 ||
          numDigits > 4 ||
          numPuncts > 0 ||
          numDigits / curParts[k].length > 0.5
        ) {
          const filePermutation = [
            ...curParts.slice(0, k),
            '*',
            ...curParts.slice(k + 1),
          ].join('/');
          if (filePermutation[filePermutation.length - 1] === '*') {
            filePermutations.push(filePermutation + '/');
          }
          filePermutations.push(filePermutation);
          textPermutations.push(
            [...curParts.slice(0, k), '*?', ...curParts.slice(k + 1)].join('/')
          );
        }
      }
      const permutation = preProcessGlobPath(curParts.join('/'));
      filePermutations.push(permutation);
      textPermutations.push(permutation);
    }
  }

  const sortFn = (a: string, b: string) => {
    if (a.length === b.length) {
      return b.split('/').length - a.split('/').length;
    } else {
      return b.length - a.length;
    }
  };

  filePermutations.sort(sortFn);
  textPermutations.sort(sortFn);

  for (let i = 0; i < filePermutations.length; i++) {
    const filePermutation = filePermutations[i];
    const textPermutation = textPermutations[i];
    let curParts = textPermutation.split('/').length;
    if (
      currentQueries >= maxQueries ||
      (curMaxParts !== null && curParts <= curMaxParts)
    ) {
      break;
    }
    // search for directories
    const filesForPermutation = await _findFilesHelper(filePermutation);
    if (filesForPermutation.length > 0) {
      const groupedFiles = groupByDirectory(filesForPermutation);
      const sortedGroupFiles = sortGroupFiles(groupedFiles, true);
      const filesStr = stringifyGroupedFiles(sortedGroupFiles);
      files.push(filesStr);
    }

    // search for text in files
    const matches = (await ripGrepHelper(textPermutation)).slice(
      0,
      maxResultsPerQuery
    );
    if (matches.length > 0) {
      textMatches.push(
        matches
          .map(({ text, uri, range }) => matchToStr(text, uri, range))
          .join('\n\n')
      );
    }
    if (filesForPermutation.length > 0 || matches.length > 0) {
      if (curMaxParts === null) {
        curMaxParts = curParts;
      }
      currentQueries += 1;
    }
  }
  if (currentQueries === 0) {
    return {
      observation: 'No relevant files found.',
      failed: true,
    };
  }
  return {
    observation: `Files relevant to endpoint '${endpoint}'\n\n${files.join(
      '\n'
    )}\n${textMatches.join('\n')}`,
    failed: false,
  };
}

/*
 * Everything above are tools
 *
 *
 * HELPER METHODS
 *
 *
 * Everything below are helper methods for the tools
 */

type GroupedFiles = Map<string, GroupedFiles>;

function groupByDirectory(files: string[]): GroupedFiles {
  const groupedFiles: GroupedFiles = new Map();

  files.forEach((file) => {
    const pathParts = file.split('/');
    let currentDir = groupedFiles;

    pathParts.map((part) => {
      if (!currentDir.has(part)) {
        currentDir.set(part, new Map());
      }
      currentDir = currentDir.get(part)!;
    });
  });

  return groupedFiles;
}

function sortGroupFiles(
  groupedFiles: GroupedFiles,
  directoryFirst: boolean = false
): GroupedFiles {
  const dirGroups: [string, GroupedFiles][] = [];
  const otherGroups: [string, GroupedFiles][] = [];
  for (const [name, subDirectory] of groupedFiles) {
    const isDir = subDirectory.size > 0;
    const groupToPush = isDir && directoryFirst ? dirGroups : otherGroups;
    const sortedSubDirectory = isDir
      ? sortGroupFiles(subDirectory, directoryFirst)
      : subDirectory;
    groupToPush.push([name, sortedSubDirectory]);
  }

  const sortedDirGroups = dirGroups.sort(([nameA], [nameB]) =>
    nameA.localeCompare(nameB)
  );
  const sortedOtherGroups = otherGroups.sort(([nameA], [nameB]) =>
    nameA.localeCompare(nameB)
  );

  return new Map([...sortedDirGroups, ...sortedOtherGroups]);
}

function filterFiles(groupedFiles: GroupedFiles, maxFiles = 100) {
  // Prune the grouped files map to only show maxFiles
  const queue = [
    { parent: {} as GroupedFiles, dirName: '', files: groupedFiles, depth: 0 },
  ];
  let curDepth = 0;
  let numFiles = 0;
  while (queue.length > 0) {
    let { parent, files, depth, dirName } = queue.shift()!;
    if (depth > curDepth && numFiles >= maxFiles) {
      const moreMap = new Map();
      if (files.size > 0) {
        moreMap.set(EXPANDSTRING, new Map());
      }
      parent.set(dirName, moreMap);
      continue;
    }
    curDepth = depth;
    for (const [name, subDirectory] of files) {
      queue.push({
        parent: files,
        dirName: name,
        files: subDirectory,
        depth: curDepth + 1,
      });
      numFiles += 1;
    }
  }
}

function stringifyGroupedFiles(
  groupedFiles: GroupedFiles,
  indent: number = 0,
  needsLeadingText: boolean = true
): string {
  let result = '';
  for (const [name, subDirectory] of groupedFiles) {
    const numSubDirs = subDirectory.size;
    const isDir = numSubDirs > 0;
    const hasOneChild = numSubDirs === 1; // && !subDirectory.has(EXPANDSTRING);
    const leadingText = needsLeadingText ? `${'\t'.repeat(indent)}- ` : '';
    const trailingSlash = isDir ? '/' : '';
    const trailingNewline = !hasOneChild ? '\n' : '';
    const numChildIndents = !hasOneChild ? indent + 1 : indent;
    // Show condensed representation if only one subdir
    result += `${leadingText}${name}${trailingSlash}${trailingNewline}`;
    result += stringifyGroupedFiles(
      subDirectory,
      numChildIndents,
      !hasOneChild
    );
  }
  return result;
}

const GITIGNORE_CACHE: Record<
  string,
  { includeGlob: string[]; excludeGlob: string[] }
> = {};

async function getGitignoreGlob(
  baseUri: Uri,
  rootUri: Uri,
  standardExcludeGlob: string[]
): Promise<{ includeGlob: string[]; excludeGlob: string[] }> {
  // Pattern to find .gitignore
  const gitignorePattern = new RelativePattern(baseUri, '**/.gitignore');
  const gitignoreUris = await workspace.findFiles(
    gitignorePattern,
    `{${standardExcludeGlob.join(',')}}`,
    MAX_RESULTS
  );

  let includeGlob: string[] = [];
  let excludeGlob: string[] = [];
  const rootPath = rootUri.path;

  for (const gitignoreUri of gitignoreUris) {
    const gitignoreDocument = await workspace.openTextDocument(gitignoreUri);
    const cacheKey = getCacheKey(gitignoreDocument);
    if (cacheKey in GITIGNORE_CACHE) {
      const cachedOutput = GITIGNORE_CACHE[cacheKey];
      includeGlob = includeGlob.concat(cachedOutput.includeGlob);
      excludeGlob = excludeGlob.concat(cachedOutput.excludeGlob);
    } else {
      const dirPath = path.dirname(gitignoreUri.path);
      const dirPathRelative = dirPath.substring(rootPath.length);
      const parsedOutput = parseIgnoreFile(
        gitignoreDocument.getText(),
        dirPathRelative
      );
      GITIGNORE_CACHE[cacheKey] = parsedOutput;
      includeGlob = includeGlob.concat(parsedOutput.includeGlob);
      excludeGlob = excludeGlob.concat(parsedOutput.excludeGlob);
    }
  }

  return { includeGlob, excludeGlob };
}

function getStandardExcludeGlob(): string[] {
  return [...getSearchExcludeGlob(), ...getFileExcludeGlob()];
}

function getSearchExcludeGlob(): string[] {
  const searchExcludeGlob = workspace.getConfiguration('search').get('exclude');
  return !!searchExcludeGlob ? Object.keys(searchExcludeGlob) : [];
}

function getFileExcludeGlob(): string[] {
  const fileExcludeGlob = workspace.getConfiguration('files').get('exclude');
  return !!fileExcludeGlob ? Object.keys(fileExcludeGlob) : [];
}

function getCacheKey(document: TextDocument): string {
  return `${document.fileName}|${document.version}`;
}

async function locationToCodeChunk(
  location: Location | LocationLink
): Promise<string> {
  const uri = 'uri' in location ? location.uri : location.targetUri;
  const range = 'range' in location ? location.range : location.targetRange;
  const document = await workspace.openTextDocument(uri);
  const textChunk = getTextFromLines(
    document,
    range.start.line,
    range.end.line
  );
  // Get line numbers in user's format
  const userStartLine = internalToUserLineNum(range.start.line);
  const userEndLine = internalToUserLineNum(range.end.line);
  const rangeText = range.isSingleLine
    ? `${userStartLine}`
    : `${userStartLine}-${userEndLine}`;
  const textChunkWithLineNum = prependLineNumbers(textChunk, userStartLine);
  return `${uri.path}:${rangeText}\n${textChunkWithLineNum}`;
}

async function symbolToString(
  symbol: DocumentSymbol | SymbolInformation,
  showFilename: boolean = false,
  showCodeChunk: boolean = false
): Promise<string> {
  return symbolToStringHelper(symbol, showFilename, showCodeChunk, 0);
}

async function symbolToStringHelper(
  symbol: DocumentSymbol | SymbolInformation,
  showFilename: boolean = false,
  showCodeChunk: boolean = false,
  depth = 0,
  maxDepth = 1
): Promise<string> {
  if (depth > maxDepth) {
    return '';
  }
  const kind = SymbolKind[symbol.kind];
  let text = `Symbol: ${symbol.name}, Kind: ${kind}`;

  if ('containerName' in symbol && symbol.containerName.length > 0) {
    text += `, Container: ${symbol.containerName}`;
  }

  const range = 'range' in symbol ? symbol.range : symbol.location.range;
  const userStartLine = internalToUserLineNum(range.start.line);
  const userEndLine = internalToUserLineNum(range.end.line);
  const rangeText = range.isSingleLine
    ? `${userStartLine}`
    : `${userStartLine}-${userEndLine}`;

  if (showFilename && 'location' in symbol) {
    text += `\n${symbol.location.uri.path}:${rangeText}`;
  } else {
    text += `, Line(s): ${rangeText}`;
  }

  if (showCodeChunk && 'location' in symbol) {
    const document = await workspace.openTextDocument(symbol.location.uri);
    const textChunk = getTextFromLines(
      document,
      range.start.line,
      range.end.line
    );
    const textChunkWithLineNum = prependLineNumbers(textChunk, userStartLine);
    text += `\n${textChunkWithLineNum}`;
  } else if (
    'children' in symbol &&
    symbol.children.length > 0 &&
    depth + 1 < maxDepth
  ) {
    const childrenDepth = depth + 1;
    const childrenIndent = '\t'.repeat(childrenDepth);
    const childrenTexts = await Promise.all(
      symbol.children.map(async (sym) =>
        symbolToStringHelper(sym, false, false, childrenDepth)
      )
    );
    const childrenTextCombined = childrenTexts.join(`\n${childrenIndent}`);
    text += `\n${childrenIndent}${childrenTextCombined}`;
  }
  return text;
}
