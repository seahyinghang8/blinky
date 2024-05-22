import {
  Diagnostic,
  DiagnosticSeverity,
  Range,
  TextDocument,
  WorkspaceEdit,
  commands,
  languages,
  workspace,
  window,
  type Disposable,
  TextEdit,
} from 'vscode';
import {
  DiffState,
  getRootUri,
  getTextFromLines,
  internalToUserLineNum,
  parseLineNumbers,
  pathToURI,
  prependLineNumbers,
  userToInternalLineNum,
} from './utils';
import { ripGrepHelper } from './navigation';
import { DIAGNOSTIC_IGNORE } from './constants';

export interface EditMetadata {
  newTextLineCount: number;
  startLineNum: number;
  oldPath?: string;
  created?: boolean;
  deleted?: boolean;
  previousText?: string;
  lineCountBeforeEdit?: number;
}

export interface EditTask {
  edit: WorkspaceEdit;
  editMetadata: Record<string, EditMetadata[]>;
}

// file for editing files

export async function createFile(
  filename: string,
  edit?: WorkspaceEdit,
  editMetadata?: Record<string, EditMetadata[]>
): Promise<EditTask> {
  if (edit === undefined) {
    edit = new WorkspaceEdit();
  }
  const fileUri = pathToURI(filename);
  edit.createFile(fileUri);
  if (editMetadata === undefined) {
    editMetadata = {};
  }
  if (editMetadata[fileUri.path] === undefined) {
    editMetadata[fileUri.path] = [];
  }
  editMetadata[fileUri.path].push({
    newTextLineCount: 0,
    startLineNum: 0,
    created: true,
  });
  return { edit, editMetadata };
}

export async function renameFile(
  filename: string,
  newFilename: string,
  edit?: WorkspaceEdit,
  editMetadata?: Record<string, EditMetadata[]>
): Promise<EditTask> {
  if (edit === undefined) {
    edit = new WorkspaceEdit();
  }
  const fileUri = pathToURI(filename);
  const newFileUri = pathToURI(newFilename);
  edit.renameFile(fileUri, newFileUri);
  if (editMetadata === undefined) {
    editMetadata = {};
  }
  if (editMetadata[newFileUri.path] === undefined) {
    editMetadata[newFileUri.path] = [];
  }
  editMetadata[newFileUri.path].push({
    newTextLineCount: 0,
    startLineNum: 0,
    oldPath: fileUri.path,
  });
  return { edit, editMetadata };
}

export async function deleteFile(
  filename: string,
  edit?: WorkspaceEdit,
  editMetadata?: Record<string, EditMetadata[]>
): Promise<EditTask> {
  if (edit === undefined) {
    edit = new WorkspaceEdit();
  }
  const fileUri = pathToURI(filename);
  edit.deleteFile(fileUri);
  if (editMetadata === undefined) {
    editMetadata = {};
  }
  if (editMetadata[fileUri.path] === undefined) {
    editMetadata[fileUri.path] = [];
  }
  const document = await workspace.openTextDocument(fileUri);
  const previousText = document.getText();
  editMetadata[fileUri.path].push({
    newTextLineCount: 0,
    startLineNum: 0,
    deleted: true,
    previousText,
  });
  return { edit, editMetadata };
}

const PREVIEW_OFFSET = 5;

async function _replaceHelper(
  filename: string,
  range: Range,
  newText: string,
  edit?: WorkspaceEdit,
  editMetadata?: Record<string, EditMetadata[]>
): Promise<EditTask> {
  if (edit === undefined) {
    edit = new WorkspaceEdit();
  }
  const fileUri = pathToURI(filename);
  edit.replace(fileUri, range, newText);
  if (editMetadata === undefined) {
    editMetadata = {};
  }
  if (editMetadata[fileUri.path] === undefined) {
    editMetadata[fileUri.path] = [];
  }
  const document = await workspace.openTextDocument(fileUri);
  const previousText = document.getText();
  const lineCountBeforeEdit = document.lineCount;
  editMetadata[fileUri.path].push({
    newTextLineCount: countNewlines(newText),
    startLineNum: range.start.line,
    previousText,
    lineCountBeforeEdit,
  });
  return { edit, editMetadata };
}

export async function replaceText(
  filename: string,
  oldText: string,
  newText: string,
  edit?: WorkspaceEdit,
  editMetadata?: Record<string, EditMetadata[]>
): Promise<EditTask> {
  const fileUri = pathToURI(filename);
  const document = await workspace.openTextDocument(fileUri);
  // Example of an oldText:
  // 1: def test():
  // 2:     print("Hello")
  // 3:     return 0
  // Remove any empty lines
  const oldTextLines = oldText.split('\n').filter((line) => line.length > 0);
  let startLineNum: number | null = null;
  let endLineNum: number | null = null;
  let currentLineNum: number | null = null;
  const lineNumTextRegex = /^\s*(\d+):(.*)$/;

  // Useful when model edits empty files
  if (!oldTextLines.length) {
    oldTextLines.push('1:'); // add a dummy line number
  }

  // parse line numbers and text from each line using regex
  // check if line numbers are consecutive and get start and end line numbera
  for (const line of oldTextLines) {
    const match = line.match(lineNumTextRegex);
    if (!match) {
      throw new Error(
        `oldText needs to be prepended with line numbers. Expected line to follow '<line_number>:<text>' format but got '${line}' instead.`
      );
    }
    // Note: code text is not used currently for more robust checks
    const [, lineNumStr, text] = match;
    const lineNum = userToInternalLineNum(parseLineNumbers(lineNumStr));

    const suggestionForLineNum = `You must use ReadFile to read ${filename} again before making edits.`;
    if (lineNum < 0 || lineNum >= document.lineCount) {
      throw new Error(
        `Line number ${lineNumStr} in oldText is out of bounds. ${suggestionForLineNum}`
      );
    }
    const textLine = document.lineAt(lineNum);
    if (textLine.text !== text) {
      throw new Error(
        `Line ${lineNumStr} in oldText does not match the text in the file. Expected '${lineNumStr}:${textLine.text}' but got '${lineNumStr}:${text}' instead. ${suggestionForLineNum}`
      );
    }

    if (currentLineNum === null) {
      currentLineNum = lineNum;
      startLineNum = currentLineNum;
    } else if (currentLineNum + 1 !== lineNum) {
      throw new Error(`Line numbers in oldText are not consecutive.`);
    } else {
      currentLineNum = lineNum;
    }
  }

  endLineNum = currentLineNum;

  if (startLineNum === null || endLineNum === null) {
    throw new Error('Old text should have line numbers');
  }
  const range = new Range(startLineNum, 0, endLineNum + 1, 0);

  // clean new text formatting in case LLM prepends it with new lines
  const newTextLines = newText.split('\n').map((line) => {
    const match = line.match(lineNumTextRegex);
    if (!match) {
      // line is formatted correctly
      return line;
    }
    const [, , text] = match;
    return text;
  });
  const cleanedNewText = newTextLines.join('\n');

  return await _replaceHelper(
    filename,
    range,
    cleanedNewText,
    edit,
    editMetadata
  );
}

export async function findAndReplaceInFiles(
  query: string,
  replacement: string,
  subdir: string = '',
  excludeGitignore: boolean = true
): Promise<EditTask> {
  const matches = await ripGrepHelper(query, subdir, excludeGitignore);
  let edit = new WorkspaceEdit();
  let editMetadata = {};
  for (const match of matches) {
    const { text, uri, range } = match;
    await _replaceHelper(
      uri.path,
      range,
      text.replace(query, replacement),
      edit,
      editMetadata
    );
  }
  return { edit, editMetadata };
}

interface FileInfoBeforeEdit {
  relativePath: string;
  listenerDisposable: Disposable | undefined;
  evaluatedDiagnostic: Promise<void>;
  document: TextDocument;
}

export async function revertToPreviousState(
  filesInfoBeforeEdit: Record<string, EditMetadata[]>
): Promise<void> {
  // TODO: Support undoing deletion, creation and renaming as well.
  // iterate through fileInfoBeforeEdit and revert the changes
  for (const path in filesInfoBeforeEdit) {
    for (const editMetadata of filesInfoBeforeEdit[path]) {
      const revertEdit = new WorkspaceEdit();
      const fileUri = pathToURI(path);
      if (editMetadata.deleted) {
        const contents =
          editMetadata.previousText === undefined
            ? undefined
            : Buffer.from(editMetadata.previousText);
        revertEdit.createFile(fileUri, { contents });
        await workspace.applyEdit(revertEdit);
        continue;
      }
      let document = await workspace.openTextDocument(fileUri);
      if (editMetadata.created) {
        revertEdit.deleteFile(fileUri);
        await workspace.applyEdit(revertEdit);
        continue;
      }
      if (editMetadata.oldPath !== undefined) {
        const oldUri = pathToURI(editMetadata.oldPath);
        revertEdit.renameFile(fileUri, oldUri);
      }
      if (editMetadata.previousText !== undefined) {
        revertEdit.replace(
          fileUri,
          new Range(0, 0, document.lineCount + 1, 0),
          editMetadata.previousText
        );
      }
      await workspace.applyEdit(revertEdit);
      if (editMetadata.oldPath !== undefined) {
        const oldUri = pathToURI(editMetadata.oldPath);
        document = await workspace.openTextDocument(oldUri);
      }
      if (editMetadata.previousText !== undefined) {
        await document.save();
      }
    }
  }
}

export async function applyOrRevertMultiple(
  edit: WorkspaceEdit,
  editInfo: Record<string, EditMetadata[]>
): Promise<{ completed: boolean; messages: string[] }> {
  const rootUri = getRootUri();
  const fileInfoBeforeEdit = new Map<string, FileInfoBeforeEdit>();
  for (const [fileUri, _] of edit.entries()) {
    let relativePath = fileUri.path.substring(rootUri.path.length);
    const document = await workspace.openTextDocument(fileUri);

    let listenerDisposable: Disposable | undefined;
    const evaluatedDiagnostic = new Promise<void>((resolve) => {
      listenerDisposable = languages.onDidChangeDiagnostics((e) => {
        for (const uri of e.uris) {
          if (uri.path === fileUri.path) {
            resolve();
          }
        }
      });
    });
    fileInfoBeforeEdit.set(fileUri.path, {
      relativePath,
      listenerDisposable,
      evaluatedDiagnostic,
      document,
    });
  }
  // Attempt to apply edit
  if (!(await workspace.applyEdit(edit))) {
    revertToPreviousState(editInfo);
    return {
      completed: false,
      messages: [
        `Failed to apply your edits due to issues with applyEdit function. Exact error is unclear.`,
      ],
    };
  }

  let allEditsSuccessful: boolean = true;
  const successMessages: string[] = [];
  const errorMessages: string[] = [];

  for (const [fileUri, _] of edit.entries()) {
    const fileInfo = fileInfoBeforeEdit.get(fileUri.path);
    if (fileInfo === undefined) {
      continue;
    }
    const { relativePath, listenerDisposable, evaluatedDiagnostic, document } =
      fileInfo;
    // Format the entire document
    const textEditor = await window.showTextDocument(document);
    const tabSize = textEditor.options.tabSize as number;
    const insertSpaces = textEditor.options.insertSpaces as boolean;
    const textEdits: TextEdit[] | undefined = await commands.executeCommand(
      'vscode.executeFormatDocumentProvider',
      fileUri,
      { tabSize, insertSpaces }
    );
    if (textEdits !== undefined) {
      const formatEdit = new WorkspaceEdit();
      formatEdit.set(fileUri, textEdits);
      await workspace.applyEdit(formatEdit);
    }

    const { lineCountBeforeEdit } = editInfo[fileUri.path][0];
    const lineCountAfterEdit = document.lineCount;
    // await for 2s
    await new Promise((resolve) => setTimeout(resolve, 2000));
    await evaluatedDiagnostic;
    // cleanup the listener
    listenerDisposable?.dispose();
    let diagnostics: Diagnostic[] = languages.getDiagnostics(fileUri);
    // Filter out diagnostics that are ignored
    diagnostics = diagnostics.filter(
      (diagnostic) =>
        !DIAGNOSTIC_IGNORE.has((diagnostic.source || '').toLowerCase()) &&
        diagnostic.severity === DiagnosticSeverity.Error
    );

    const editSuccessful = diagnostics.length === 0;
    if (editSuccessful) {
      // Persist the change (which might also format the document too)
      await document.save();
    }

    // Just preview all the edits in the file
    const previewTexts: string[] = [];
    for (const { newTextLineCount, startLineNum } of editInfo[fileUri.path]) {
      // This calculation is actually wrong because of multiple edits and formatting changes, but it's good enough for now
      const { previewStartLine, previewEndLine } = getPreviewStartAndEndLine(
        startLineNum,
        lineCountBeforeEdit!,
        lineCountAfterEdit,
        newTextLineCount,
        PREVIEW_OFFSET
      );
      const previewText = getTextFromLines(
        document,
        previewStartLine,
        previewEndLine
      );
      const numberedPreviewText = prependLineNumbers(
        previewText,
        internalToUserLineNum(previewStartLine)
      );
      previewTexts.push(numberedPreviewText);
    }
    const aggNumberedPreviewText = previewTexts.join('\n----------------\n');

    if (editSuccessful) {
      // Add preview text to success message
      successMessages.push(
        `Successfully edited ${relativePath} with no issues.\n` +
          `Content of ${relativePath} after edit:\n${aggNumberedPreviewText}`
      );
      // Continue to next file
      continue;
    }

    allEditsSuccessful = false;

    // Edit caused language errors, show preview text and language errors
    const diagnosticText = diagnostics
      .map((diagnostic) => {
        const sev = DiagnosticSeverity[diagnostic.severity];
        const dStartLine = internalToUserLineNum(diagnostic.range.start.line);
        const dEndLine = internalToUserLineNum(diagnostic.range.end.line);
        const sourceText =
          diagnostic.source === undefined ? '' : `${diagnostic.source} `;
        const rangeText = diagnostic.range.isSingleLine
          ? `${dStartLine}`
          : `${dStartLine}-${dEndLine}`;
        return `- ${sourceText}${sev}: ${diagnostic.message} (${relativePath}:${rangeText})`;
      })
      .join('\n');

    errorMessages.push(
      `Failed to edit ${relativePath}. Edit caused ${diagnostics.length} issue(s):\n` +
        diagnosticText +
        `\n\nChange was reverted. Preview of ${relativePath} if edit was applied:\n${aggNumberedPreviewText}`
    );
  }

  if (allEditsSuccessful) {
    // Check for creations and deletions (since we only handle text edits above)
    for (const path in editInfo) {
      for (const { created, deleted } of editInfo[path]) {
        if (created) {
          successMessages.push(
            `Successfully created ${path}.\n----------------\n`
          );
        } else if (deleted) {
          successMessages.push(
            `Successfully deleted ${path}.\n----------------\n`
          );
        }
      }
    }
    return { completed: true, messages: successMessages };
  }
  revertToPreviousState(editInfo);
  return { completed: false, messages: errorMessages };
}

export async function redoFn(historicalDiff: Record<string, DiffState>) {
  const edit = new WorkspaceEdit();
  for (const path in historicalDiff) {
    const {
      initialText,
      initialPath,
      currentText,
      currentPath,
      created,
      deleted,
    } = historicalDiff[path];
    if (created && currentPath) {
      const contents =
        currentText === undefined ? undefined : Buffer.from(currentText);
      edit.createFile(pathToURI(currentPath), { contents });
    } else if (deleted && currentPath) {
      edit.deleteFile(pathToURI(currentPath));
    }
    if (initialPath && currentPath && initialPath !== currentPath) {
      edit.renameFile(pathToURI(initialPath), pathToURI(currentPath));
    }
    if (initialText && currentText && currentPath) {
      const document = await workspace.openTextDocument(pathToURI(currentPath));
      const range = new Range(0, 0, document.lineCount + 1, 0);
      edit.replace(pathToURI(currentPath), range, currentText);
    }
  }
  try {
    await workspace.applyEdit(edit);
    for (const path in historicalDiff) {
      const { currentPath, deleted } = historicalDiff[path];
      if (currentPath && !deleted) {
        const document = await workspace.openTextDocument(
          pathToURI(currentPath)
        );
        await document.save();
      }
    }
  } catch (e) {
    console.error(e);
  }
}

function countNewlines(text: string): number {
  const regex = /\n/g;
  const matches = text.match(regex);
  return matches ? matches.length : 0;
}

function getPreviewStartAndEndLine(
  startLine: number,
  lineCountBeforeEdit: number,
  lineCountAfterEdit: number,
  newTextLineCount: number,
  offset: number
): { previewStartLine: number; previewEndLine: number } {
  const editStartLine = Math.min(startLine, lineCountBeforeEdit - 1);
  const previewStartLine = Math.max(editStartLine - offset, 0);
  const editEndLine = editStartLine + newTextLineCount;
  const previewEndLine = Math.min(editEndLine + offset, lineCountAfterEdit - 1);
  return { previewStartLine, previewEndLine };
}
