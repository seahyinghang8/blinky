/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *
 *  Modified for the extension
 *--------------------------------------------------------------------------------------------*/

export function parseIgnoreFile(
  ignoreContents: string,
  dirPath: string
): { includeGlob: string[]; excludeGlob: string[] } {
  // Validate the path format for dirpath
  if (dirPath[dirPath.length - 1] === '\\') {
    throw Error(
      'Unexpected path format for dirpath, do not use trailing backslashes'
    );
  }
  if (dirPath[dirPath.length - 1] !== '/') {
    dirPath += '/';
  }

  const contentLines = ignoreContents
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && line[0] !== '#');

  // Check if line should be ignored
  const ignoreLines = contentLines.filter((line) => !line.includes('!'));
  const excludeGlob = gitignoreLinesToGlobs(ignoreLines, dirPath);

  // TODO: Slight hack... this naieve approach may reintroduce too many files in cases of weirdly complex .gitignores
  const includeLines = contentLines
    .filter((line) => line.includes('!'))
    .map((line) => line.replace(/!/g, ''));
  const includeGlob = gitignoreLinesToGlobs(includeLines, dirPath);

  return { includeGlob, excludeGlob };
}

function gitignoreLinesToGlobs(lines: string[], dirPath: string): string[] {
  return lines.map((line) => gitignoreLineToGlob(line, dirPath));
}

function gitignoreLineToGlob(line: string, dirPath: string): string {
  const firstSep = line.indexOf('/');
  if (firstSep === -1 || firstSep === line.length - 1) {
    line = '**/' + line;
  } else {
    if (firstSep === 0) {
      line = line.slice(1);
    }
    if (dirPath.slice(-1) === '/') {
      dirPath = dirPath.slice(0, -1);
    }
    line = dirPath + '/' + line;
    // remove the leading slash
    if (line[0] === '/') {
      line = line.slice(1);
    }
  }
  // add trailing * if matching on a directory
  if (line.slice(-1) === '/') {
    line = line + '**';
  }
  return line;
}
