import { WorkspaceEdit } from 'vscode';

import { Action } from '../agents/types';
import { CODE_SIGNIFIER } from './constants';
import {
  createFile,
  deleteFile,
  findAndReplaceInFiles,
  renameFile,
  replaceText,
  applyOrRevertMultiple,
  EditTask,
  EditMetadata,
} from './edit';
import {
  getAllReferences,
  goToDefinition,
  readFile,
  getFileSymbols,
  searchCodeSymbol,
  listDirectoryRecursive,
  findFiles,
  listDirectory,
  findTextInFiles,
  getFilesRelevantToEndpoint,
} from './navigation';
import { Verifier } from './verifier';

interface ITool {
  name: string;
  description: string;
  paramsDescription: string[];
  type: ToolType;
  func: (
    ...args: any[]
  ) => Promise<{ observation: string; failed: boolean } | EditTask>;
}

enum ToolType {
  Navigation,
  Edit,
  Execute,
}

export function toolSignature(tool: ITool) {
  let paramsListStr = '';
  if (tool.paramsDescription.length === 0) {
    paramsListStr = 'None';
  } else {
    for (const param of tool.paramsDescription) {
      paramsListStr += `- ${param}\n`;
    }
  }
  // TODO: Modify this to make it more understandable for the LLM
  return `${tool.name}\n${tool.description}\nParams:\n${paramsListStr}`;
}

export class Toolbox {
  public tools: Record<string, ITool> = {};

  async initialize(
    verifier?: Verifier,
    backtrackFn?: (...args: any[]) => Promise<string>
  ) {
    this.registerTool({
      name: 'ReadFile',
      description: 'Read the contents of the file given a filename',
      paramsDescription: [
        'filename',
        'startLineNum (optional, defaults to 1)',
        'endLineNum (optional, defaults to number of lines of file)',
      ],
      func: readFile,
      type: ToolType.Navigation,
    });
    this.registerTool({
      name: 'GetFileSymbols',
      description:
        'Get the code symbols (functions and variables) of a file. Do not use this if you have already used ReadFile.',
      paramsDescription: ['filename'],
      func: getFileSymbols,
      type: ToolType.Navigation,
    });
    this.registerTool({
      name: 'GoToDefinition',
      description:
        'Go to the location(s) where the variable or function is defined',
      paramsDescription: ['filename', 'lineNum', 'variableOrFunctionName'],
      func: goToDefinition,
      type: ToolType.Navigation,
    });
    this.registerTool({
      name: 'GetAllReferences',
      description:
        'Get all the location(s) where the variable or function is referenced',
      paramsDescription: [
        'filename',
        'lineNum',
        'variableOrFunctionName',
        'subDirectory (optional)',
      ],
      func: getAllReferences,
      type: ToolType.Navigation,
    });
    // this.registerTool({
    //   name: 'SearchCodeSymbol',
    //   description:
    //     'Search for code symbols (functions and variables) across the workspace that matches query.',
    //   paramsDescription: ['query'],
    //   func: searchCodeSymbol,
    // });
    // this.registerTool({
    //   name: 'ListDirectory',
    //   description: 'List the contents of the given directory path',
    //   paramsDescription: [
    //     'directoryPath (optional, defaults to project root dir)',
    //   ],
    //   func: listDirectory,
    // });
    this.registerTool({
      name: 'ListDirectoryRecursively',
      description:
        'List the contents of the given directory path recursively to see all the files',
      paramsDescription: [
        'directoryPath (optional, defaults to project root dir)',
      ],
      func: listDirectoryRecursive,
      type: ToolType.Navigation,
    });
    this.registerTool({
      name: 'FindFiles',
      description:
        'Find file paths that matches the query. Query can include glob patterns such as * to denote a wildcard',
      paramsDescription: ['query'],
      func: findFiles,
      type: ToolType.Navigation,
    });
    this.registerTool({
      name: 'FindTextInFiles',
      description:
        'Find text in the content of files that matches with the query. Note that this function is case-insensitive.',
      paramsDescription: ['query', 'subDirectory (optional)'],
      func: findTextInFiles,
      type: ToolType.Navigation,
    });
    this.registerTool({
      name: 'FindAndReplaceTextInFiles',
      description:
        'Find and replace text in files. Always use FindTextInFiles to see what you are replacing before calling this function. Note that this function is case-sensitive. So make sure to match the different cases of the text you are replacing e.g. variableName, VariableName, variablename etc.',
      paramsDescription: ['query', 'replacement', 'subDirectory (optional)'],
      func: findAndReplaceInFiles,
      type: ToolType.Edit,
    });
    this.registerTool({
      name: 'CreateFile',
      description: 'Create a file with the given filename.',
      paramsDescription: ['filename'],
      func: createFile,
      type: ToolType.Edit,
    });
    this.registerTool({
      name: 'RenameFile',
      description: 'Rename a file from filename to newFilename.',
      paramsDescription: ['filename', 'newFilename'],
      func: renameFile,
      type: ToolType.Edit,
    });
    this.registerTool({
      name: 'DeleteFile',
      description: 'Delete a file with the given filename.',
      paramsDescription: ['filename'],
      func: deleteFile,
      type: ToolType.Edit,
    });
    this.registerTool({
      name: 'ReplaceText',
      description:
        `Replace the old text block with line numbers with the new text blocks. You MUST retain the comments and correct indentation in oldText and newText.\n\n` +
        `Example usage:\n` +
        `<function>\n` +
        `ReplaceText(filename="test.py")\n` +
        `${CODE_SIGNIFIER}oldText\n` +
        `5:def helloworld(a):\n` +
        `6:\n` +
        `7:    b = a + 2\n` +
        `${CODE_SIGNIFIER}\n` +
        `${CODE_SIGNIFIER}newText\n` +
        `5:def helloworld(a):\n` +
        `6:    # Show the user the input value\n` +
        `7:    print(f"Input of helloword(a={a})")\n` +
        `8:    b = a + 2\n` +
        `${CODE_SIGNIFIER}\n` +
        `</function>`,
      paramsDescription: [
        'filename',
        'oldText - The old text block that you are trying to replace with line numbers. Retain the correct indentation and comments. Read the content of the file around the oldText before editing.',
        'newText - The new text block that would replace the old text block. Retain the correct indentation and comments. Any line numbers prepended will be ignored.',
      ],
      func: replaceText,
      type: ToolType.Edit,
    });
    this.registerTool({
      name: 'GetFilesRelevantToEndpoint',
      description:
        'If you are debugging a backend api endpoint, see which files which might contain the entrypoint so you can start debugging from there. This is useful when you are not sure where to start debugging.',
      paramsDescription: ['endpoint e.g. "/auth/user/login"'],
      func: getFilesRelevantToEndpoint,
      type: ToolType.Navigation,
    });
    if (verifier) {
      this.registerTool({
        name: 'Verify',
        description:
          'Run verify to check your work and get feedback on whether you have completed the task correctly.',
        paramsDescription: [],
        func: async () => {
          const result = await verifier.verify();
          return {
            observation: result.logs,
            failed: false,
          };
        },
        type: ToolType.Execute,
      });
    }
    if (backtrackFn) {
      this.registerTool({
        name: 'Backtrack',
        description:
          'Backtrack to the previous state. Only Use this when you are not making any progress in your current debugging path so you can go back and go down another path. This will undo all edits and history till that state. Make sure to summarize the path and conclusion you reached in the discussion section before backtracking. Use this sparingly.',
        paramsDescription: ['id: id of the state to backtrack to.'],
        func: async (id) => {
          return {
            observation: await backtrackFn(id, true),
            failed: false,
          };
        },
        type: ToolType.Navigation,
      });
    }
  }

  getToolsSignature(): string[] {
    let toolsSignature = [];
    for (const tool of Object.values(this.tools)) {
      toolsSignature.push(toolSignature(tool));
    }
    return toolsSignature;
  }

  registerTool(tool: ITool) {
    this.tools[tool.name] = tool;
  }

  async executeActions(actions: Action[]): Promise<{
    observations: string[];
    editInfo: Record<string, EditMetadata[]> | {};
    failed: boolean;
  }> {
    const _combineEditInfo = (
      aggregatedEditInfo: Record<string, EditMetadata[]>,
      editMetadata: Record<string, EditMetadata[]>
    ) => {
      for (const [filename, edits] of Object.entries(editMetadata)) {
        if (filename in aggregatedEditInfo) {
          aggregatedEditInfo[filename].push(...edits);
        } else {
          aggregatedEditInfo[filename] = edits;
        }
      }
    };

    let aggregatedEditInfo: Record<string, EditMetadata[]> = {};
    let edit = new WorkspaceEdit();
    let editMetadata = {};
    let editEmpty = true;
    let observations: string[] = [];
    let failed = false;
    // Chains consecutive edit actions together
    for (const action of actions) {
      const { toolName, params } = action;
      try {
        if (!(toolName in this.tools)) {
          observations.push(
            `${toolName} does not exists in the set of tools. Please refer to the list of available tools in the prompt.`
          );
          continue;
        }
        const tool = this.tools[toolName];
        if (params.length < tool.paramsDescription.length) {
          // push undefined for optional params
          const diff = tool.paramsDescription.length - params.length;
          for (let i = 0; i < diff; i++) {
            params.push('');
          }
        }
        // If the tool is an edit tool, chain the edits together
        if (tool.type === ToolType.Edit) {
          await tool.func(...params, edit, editMetadata);
          editEmpty = false;
          continue;
        }
        if (!editEmpty) {
          // edit chain is over so apply the edit
          const { completed, messages } = await applyOrRevertMultiple(
            edit,
            editMetadata
          );
          for (const message of messages) {
            observations.push(message);
          }
          if (!completed) {
            failed = true;
            break;
          } else {
            _combineEditInfo(aggregatedEditInfo, editMetadata);
          }
          edit = new WorkspaceEdit();
          editMetadata = {};
          editEmpty = true;
        }
        const toolOutput = (await tool.func(...params)) as {
          observation: string;
          failed: boolean;
        };
        failed = failed || (toolOutput.failed as boolean);
        observations.push(toolOutput.observation || '');
      } catch (e: any) {
        observations.push(
          `Usage of ${toolName} failed due to error: ${e.message}`
        );
        failed = true;
      }
    }
    if (!editEmpty) {
      const { completed, messages } = await applyOrRevertMultiple(
        edit,
        editMetadata
      );
      for (const message of messages) {
        observations.push(message);
      }
      if (!completed) {
        failed = true;
      } else {
        _combineEditInfo(aggregatedEditInfo, editMetadata);
      }
    }
    return {
      observations,
      editInfo: aggregatedEditInfo,
      failed,
    };
  }
}
