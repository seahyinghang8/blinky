import {
  Position,
  Range,
  TextDocument,
  Uri,
  WorkspaceEdit,
  workspace,
} from 'vscode';
import { CODE_SIGNIFIER, LOG_SIGNIFIER } from './constants';
import { Message } from '../agents/types';

export function parseLineNumbers(lineNumStr: string): number {
  const lineNum = parseInt(lineNumStr);
  // Not a parsable number
  if (isNaN(lineNum)) {
    throw Error(`Line number ${lineNumStr} could not be parsed as an int.`);
  }
  return lineNum;
}

export function checkLineInRange(
  document: TextDocument,
  lineNum: number
): boolean {
  return lineNum < 0 || lineNum >= document.lineCount;
}

export function prependLineNumbers(text: string, startLineNum: number): string {
  const lines = text.split('\n');
  const linesPrepended = lines.map(
    (line, idx) => `${idx + startLineNum}:${line}`
  );
  const textPrepended = linesPrepended.join('\n');
  return textPrepended;
}

export function getTextFromLines(
  document: TextDocument,
  startLine: number,
  endLineInclusive: number
): string {
  if (checkLineInRange(document, startLine)) {
    throw Error(
      `Start line number ${internalToUserLineNum(
        startLine
      )} is out of the line range for '${
        document.fileName
      }:1-${internalToUserLineNum(document.lineCount - 1)}'.`
    );
  }
  if (checkLineInRange(document, endLineInclusive)) {
    throw Error(
      `End line number ${internalToUserLineNum(
        endLineInclusive
      )} is out of the line range for '${
        document.fileName
      }:1-${internalToUserLineNum(document.lineCount - 1)}'.`
    );
  }
  const endLineExclusivePosition = new Position(endLineInclusive + 1, 0);
  let endPosition = document.validatePosition(endLineExclusivePosition);
  if (endPosition.compareTo(endLineExclusivePosition) === 0) {
    // if validated position did not change, then end position is not at the end of file
    // thus, we should decrement the position by offset to get the last character of the previous line
    endPosition = document.positionAt(document.offsetAt(endPosition) - 1);
  }
  const lineRange = new Range(new Position(startLine, 0), endPosition);
  const textChunk = document.getText(lineRange);
  return textChunk;
}

export function internalToUserLineNum(num: number): number {
  return num + 1;
}

export function userToInternalLineNum(num: number): number {
  return num - 1;
}

export function getRootUri(): Uri {
  if (!workspace.workspaceFolders) {
    throw Error('No base workspace for the root path.');
  }
  // ensure root uri path ends with a trailing slash
  return Uri.joinPath(workspace.workspaceFolders[0].uri, './');
}

export function pathToURI(path: string, isDirectory: boolean = false): Uri {
  const trimmedPath = path.trim();
  if (trimmedPath.startsWith('/')) {
    return Uri.parse(trimmedPath);
  } else if (isDirectory) {
    // ensure directory path ends with a trailing slash
    return Uri.joinPath(getRootUri(), path, './');
  } else {
    return Uri.joinPath(getRootUri(), path);
  }
}

export async function getPositionFromLineNumAndText(
  document: TextDocument,
  lineNumStr: string,
  matchingText: string
): Promise<Position> {
  const lineNum = userToInternalLineNum(parseLineNumbers(lineNumStr));
  // Out of line range
  if (checkLineInRange(document, lineNum)) {
    throw Error(
      `Line number ${internalToUserLineNum(
        lineNum
      )} is out of the line range for '${
        document.fileName
      }:1-${internalToUserLineNum(document.lineCount - 1)}'.`
    );
  }
  const line = document.lineAt(lineNum);
  const matchIndex = line.text.indexOf(matchingText);
  // Nothing matches in the text
  if (matchIndex === -1) {
    throw Error(
      `Matching text '${matchingText}' could not be found in '${
        line.text
      }' of '${document.fileName}:${internalToUserLineNum(lineNum)}'.`
    );
  }
  return new Position(lineNum, matchIndex);
}

export function preProcessGlobPath(path: string): string {
  path = path.trim();
  path = path.replace(/\[(\w+)\]/g, '[[]$1[]]');
  path = path.replace('{', '');
  path = path.replace('}', '');
  return path;
}

export function parseAction(
  actionSection: string,
  stream?: boolean
): {
  toolName: string;
  params: string[];
} {
  const regex = /^(\w+)\(([^)]*)\)$/; // matches function name and parameters
  actionSection = actionSection.trim();
  let action = actionSection;
  let codeParams: string[] = [];
  let intermediationActionSection = `${actionSection}`;
  let codeSection = '';
  if (intermediationActionSection.includes(CODE_SIGNIFIER)) {
    action = actionSection
      .substring(0, actionSection.indexOf(CODE_SIGNIFIER))
      .trim();
    codeSection = actionSection
      .substring(actionSection.indexOf(CODE_SIGNIFIER))
      .trim();
  }
  while (intermediationActionSection.includes(CODE_SIGNIFIER)) {
    const codeStartIndex = intermediationActionSection.indexOf(CODE_SIGNIFIER);
    const newLineIndex = intermediationActionSection.indexOf(
      '\n',
      codeStartIndex
    );
    const codeEndIndex = intermediationActionSection.indexOf(
      CODE_SIGNIFIER,
      codeStartIndex + 1
    );
    codeParams.push(
      intermediationActionSection.substring(newLineIndex + 1, codeEndIndex)
    );
    intermediationActionSection = intermediationActionSection.substring(
      codeEndIndex + CODE_SIGNIFIER.length + 1
    );
  }
  const match = action.match(regex);
  if (!match) {
    throw new Error();
  }
  const [_, toolName, paramsStr] = match;
  if (stream) {
    const streamParams = [];
    if (codeSection.length > 0) {
      streamParams.push(codeSection);
    }
    return { toolName, params: streamParams };
  }
  if (!paramsStr || paramsStr.trim().length === 0) {
    return { toolName, params: [] };
  }
  const params = paramsStr.split(',').map((param) => {
    const trimmedParam = param.trim();
    let value;
    if (
      // e.g. 'param="value"'
      trimmedParam.includes('="') &&
      trimmedParam[trimmedParam.length - 1] === '"'
    ) {
      value = trimmedParam.substring(trimmedParam.indexOf('=') + 1);
    } else if (
      // e.g. "param='value'"
      trimmedParam.includes("='") &&
      trimmedParam[trimmedParam.length - 1] === "'"
    ) {
      // remove single quotes since json does not support them
      value = trimmedParam
        .slice(0, -1)
        .substring(trimmedParam.indexOf('=') + 2);
    } else if (
      // e.g. 'param=value'
      trimmedParam.includes('=') &&
      trimmedParam[trimmedParam.length - 1] !== '"'
    ) {
      value = trimmedParam.substring(trimmedParam.indexOf('=') + 1);
    } else {
      // 'value', value
      value = trimmedParam;
    }
    const cleanedValue = value.trim();
    try {
      return JSON.parse(cleanedValue);
    } catch (error) {
      return cleanedValue;
    }
  });
  return { toolName, params: [...params, ...codeParams] };
}

export async function removeFunctionCallsWithMatchingText(
  documents: TextDocument[],
  matchingText: string
): Promise<void> {
  const regex = new RegExp(
    `^\\s*[\\w|\\.]+\\(\\s*([^)]*${matchingText}.*){1}\\s*\\);?$`,
    'gm'
  );
  const edit = new WorkspaceEdit();
  for (const document of documents) {
    const text = document.getText();
    const match = [...text.matchAll(regex)];
    match.forEach((item) => {
      const startLine = document.positionAt(item.index).line;
      const endLine = document.positionAt(item.index + item[0].length).line;
      const range = new Range(startLine, 0, endLine + 1, 0);
      edit.delete(document.uri, range);
    });
  }
  await workspace.applyEdit(edit);
  for (const document of documents) {
    await document.save();
  }
}

export interface DiffState {
  initialText?: string;
  initialPath?: string;
  currentText?: string;
  currentPath?: string;
  created?: boolean;
  deleted?: boolean;
}

export async function getHistoricalDiff(
  history: Message[],
  removeLogs: boolean = true
): Promise<Record<string, DiffState>> {
  // figure out files that have changed
  const files = new Set<string>();
  const deletedFiles = new Set<string>();
  const oldFileNames = new Set<string>();
  const diffStates: Record<string, DiffState> = {};
  for (const state of history) {
    for (const path in state.editInfo) {
      for (const edit of state.editInfo[path]) {
        if (edit.deleted) {
          deletedFiles.add(path);
          break;
        }
        if (edit.oldPath) {
          oldFileNames.add(edit.oldPath);
        }
      }
      files.add(path);
    }
  }
  const uniqueFiles = Array.from(files);
  const edittedDocs = await Promise.all(
    uniqueFiles
      .filter((path) => !deletedFiles.has(path) && !oldFileNames.has(path))
      .map((path) => {
        return workspace.openTextDocument(pathToURI(path));
      })
  );
  if (removeLogs) {
    await removeFunctionCallsWithMatchingText(edittedDocs, LOG_SIGNIFIER);
  }
  for (const f of files) {
    let path = f;
    if (oldFileNames.has(path)) {
      continue;
    }
    const document = deletedFiles.has(path)
      ? undefined
      : await workspace.openTextDocument(pathToURI(path));
    diffStates[path] = {
      currentPath: path,
      currentText: document ? document.getText() : undefined,
    };
    let i = history.length - 1;
    while (i >= 0) {
      const message = history[i];
      const editInfo = message.editInfo;
      if (!editInfo || !editInfo[path]) {
        i -= 1;
        continue;
      }
      let edits = editInfo[path];
      let j = edits.length - 1;
      while (j >= 0) {
        const edit = edits[j];
        if (edit.created) {
          diffStates[f].created = true;
          break;
        }
        if (edit.deleted) {
          diffStates[f].deleted = true;
          diffStates[f].initialText = edit.previousText;
          break;
        }
        if (edit.oldPath) {
          diffStates[f].initialPath = edit.oldPath;
          path = edit.oldPath;
        }
        if (edit.previousText) {
          diffStates[f].initialText = edit.previousText;
        }
        j -= 1;
      }
      i -= 1;
    }
  }
  // remove files that have not changed except for console logs
  for (const f of files) {
    if (!diffStates[f].initialText && !diffStates[f].currentText) {
      continue;
    }
    if (
      diffStates[f].created ||
      diffStates[f].deleted ||
      diffStates[f].initialPath
    ) {
      continue;
    }
    if (diffStates[f].initialText === diffStates[f].currentText) {
      delete diffStates[f];
    }
  }
  return diffStates;
}
