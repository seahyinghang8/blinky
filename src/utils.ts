import { Action } from './agents/types';
import { DemonstrationStep } from './config/types';
import { DiffState } from './tools/utils';
import {
  LogType,
  VerificationStepArgs,
  VerificationStepType,
} from './tools/verifier';

import * as vscode from 'vscode';
import { spawnSync } from 'child_process';
import { existsSync } from 'fs';

export const OutputChannel = vscode.window.createOutputChannel('Blinky');
OutputChannel.show();

export interface ReproVals {
  buildCommand: string;
  testCommand: string;
  expectedInstruction: string;
  expectedStatus: string;
  expectedBody: string;
}

export function interpolate(
  template: string,
  values: Object,
  sep: string = '{}'
) {
  var len = sep.length;

  var whitespace = '\\s*';
  var left = escape(sep.substring(0, len / 2)) + whitespace;
  var right = whitespace + escape(sep.substring(len / 2, len));

  function escape(s: string) {
    return [].map
      .call(s, function (char) {
        return '\\' + char;
      })
      .join('');
  }

  function regExp(key: string) {
    return new RegExp(left + key + right, 'g');
  }
  Object.keys(values).forEach(function (key) {
    var value = String(values[key as keyof typeof values]).replace(
      /\$/g,
      '$$$$'
    );
    template = template.replace(regExp(key), value);
  });
  return template;
}

type MessageRole = 'agent' | 'user' | 'user-pending';

interface IMessage {
  id: string;
  role: MessageRole;
  text: string;
  actions?: Action[];
  observations?: string[];
  wsDiffs?: {
    wsRoot: string;
    diffs: Record<string, DiffState>;
  };
}

export function convertTrajectoryToMessages(
  trajectory: DemonstrationStep[],
  pendingUserMessage: string[]
): IMessage[] {
  const messages: IMessage[] = [];
  for (let i = 0; i < trajectory.length; i++) {
    const step = trajectory[i];
    const actions: Action[] = [];
    const observations: string[] = [];
    if (step.actions) {
      for (let i = 0; i < step.actions.length; i++) {
        const action = step.actions[i];
        if (action.toolName === 'ReplaceText') {
          // Only include the first parameter
          actions.push({
            toolName: 'ReplaceText',
            params: [action.params[0]],
          });
          observations.push(
            `Attempting to replace oldText with newText in '${action.params[0]}':\n` +
              '```oldText\n' +
              `${action.params[1]}\n` +
              '```\n' +
              '```newText\n' +
              `${action.params[2]}\n`
          );
        } else {
          actions.push(action);
        }
      }

      if (step.observations) {
        observations.push(...step.observations);
      } else if (
        step.actions[0].toolName !== 'Exit' &&
        step.actions[0].toolName !== 'Done'
      ) {
        observations.push('Still processing...');
      }
    }
    const message: IMessage = {
      id: i.toString(),
      role: step.role as 'agent' | 'user',
      text: step.thought!,
      actions,
      observations,
      wsDiffs: step.wsDiffs,
    };
    messages.push(message);
  }
  for (let i = 0; i < pendingUserMessage.length; i++) {
    const message: IMessage = {
      id: 'p-' + i.toString(),
      role: 'user-pending',
      text: pendingUserMessage[i],
    };
    messages.push(message);
  }
  return messages;
}

export function convertReproValsToVerificationSteps(
  reproVals: ReproVals
): VerificationStepArgs[] {
  const steps: VerificationStepArgs[] = [];
  if (
    reproVals.buildCommand.trim() === '' &&
    reproVals.testCommand.trim() === ''
  ) {
    return steps;
  }
  // Get user set build command timeout and process ready text (if any)
  const reproConfig = vscode.workspace.getConfiguration('blinky.repro');
  if (reproVals.buildCommand.trim() !== '') {
    // Build Step e.g. starting the server
    const buildStep: VerificationStepArgs = {
      type: VerificationStepType.LocalProcess,
      command: reproVals.buildCommand,
      defaultLogTextFilters:
        'DEBUG-BLINKY:|error|Error|exception|Exception|fail|Fail',
      defaultLogTypeFilters: [LogType.ERROR, LogType.STDERR],
    };
    const buildReadyText: string | undefined =
      reproConfig.get('buildReadyText');
    if (buildReadyText && buildReadyText.length > 0) {
      buildStep.processReadyKeywords = [buildReadyText];
    }
    const buildInactivityTimeout: number | null | undefined = reproConfig.get(
      'buildInactivityTimeout'
    );
    const buildProcessTimeout: number | null | undefined = reproConfig.get(
      'buildProcessTimeout'
    );
    if (buildInactivityTimeout && buildInactivityTimeout > 0) {
      buildStep.inactivityTimeout = buildInactivityTimeout;
    }
    if (buildProcessTimeout && buildProcessTimeout > 0) {
      buildStep.processTimeout = buildProcessTimeout;
    }
    steps.push(buildStep);
  }
  if (reproVals.testCommand.trim() === '') {
    return steps;
  }
  // Test Step e.g. sending a request to the server
  let testCommand = reproVals.testCommand.trim();
  const { expectedStatus, expectedBody, expectedInstruction } = reproVals;
  let evalInstruction = '';
  if (expectedStatus !== '' || expectedBody !== '') {
    evalInstruction = `Verify that the expected status code is ${expectedStatus} and expected body is ${expectedBody}`;
  } else if (expectedInstruction !== '') {
    evalInstruction = `Look at the user's instruction and verify the response manually.\nUser Instruction: ${expectedInstruction}`;
  } else {
    evalInstruction = `You have to figure out what the expected response should be.`;
  }
  let responseEval = (_: string) => ({
    logs: evalInstruction,
    pass: false,
  });
  if (testCommand.startsWith('curl')) {
    // add a -i to the test command to include headers in the output
    // and -s to suppress progress meter
    testCommand += ' -i -s';
    if (expectedStatus !== '' || expectedBody !== '') {
      responseEval = getCurlResponseEvaluator(
        parseInt(expectedStatus),
        JSON.parse(expectedBody || '{}')
      );
    }
  }
  const testStep: VerificationStepArgs = {
    type: VerificationStepType.LocalProcess,
    command: testCommand,
    evaluateOutput: responseEval,
  };
  const testInactivityTimeout: number | null | undefined = reproConfig.get(
    'testInactivityTimeout'
  );
  const testProcessTimeout: number | null | undefined =
    reproConfig.get('testProcessTimeout');
  if (testInactivityTimeout && testInactivityTimeout > 0) {
    testStep.inactivityTimeout = testInactivityTimeout;
  }
  if (testProcessTimeout && testProcessTimeout > 0) {
    testStep.processTimeout = testProcessTimeout;
  }
  steps.push(testStep);
  return steps;
}

export function getJsonResponseEvaluator(
  expectedStatusCode: number,
  expectedRespSubset: Object
): (resp: Response) => Promise<{
  logs: string;
  pass: boolean;
}> {
  return async (resp: Response) => {
    try {
      const respBody = await resp.json();
      return _compareJsonResponses(
        resp.status,
        respBody,
        expectedStatusCode,
        expectedRespSubset
      );
    } catch (e) {
      return {
        logs: `Test FAIL! Error parsing response body: ${e}`,
        pass: false,
      };
    }
  };
}

export function getCurlResponseEvaluator(
  expectedStatusCode: number,
  expectedRespSubset: Object
): (output: string) => {
  logs: string;
  pass: boolean;
} {
  return (output: string) => {
    try {
      const { statusCode, body } = parseCurlOutput(output);
      return _compareJsonResponses(
        statusCode || 0,
        body,
        expectedStatusCode,
        expectedRespSubset
      );
    } catch (e) {
      return {
        logs: `Test FAIL! Error parsing response body: ${e}`,
        pass: false,
      };
    }
  };
}

function _compareJsonResponses(
  actualStatus: number,
  actualBody: any,
  expectedStatusCode: number,
  expectedRespSubset: any
) {
  const statusMatched = actualStatus === expectedStatusCode;
  const bodyMatched = isSubsetOf(expectedRespSubset, actualBody);

  if (!!bodyMatched && !!statusMatched) {
    return {
      logs: `Test PASS! Response body matches the expected output.`,
      pass: true,
    };
  }

  let failureLogs = 'Test FAIL!';

  if (!statusMatched) {
    failureLogs += `\nExpected status code ${expectedStatusCode}, but got ${actualStatus}.`;
  }

  if (!bodyMatched) {
    failureLogs += `\nExpected response body to contain ${JSON.stringify(
      expectedRespSubset
    )}, but got ${JSON.stringify(actualBody)}.`;
  }
  return { logs: failureLogs, pass: false };
}

function parseCurlOutput(curlOutput: string): {
  statusCode: number | null;
  headers: { [key: string]: string };
  body: string;
} {
  // Split the output into header and body sections
  curlOutput = curlOutput.trim();
  curlOutput = curlOutput.substring(curlOutput.indexOf('HTTP'));
  if (!curlOutput.match(/HTTP\/.* (\d{3}) (.*)/)) {
    return {
      statusCode: null,
      headers: {},
      body: curlOutput.trim(),
    };
  }
  let headerSplitIdx = curlOutput.indexOf('\n\n');
  if (headerSplitIdx === -1) {
    headerSplitIdx = curlOutput.indexOf('\r\n\r\n');
  }
  const headers = curlOutput.substring(0, headerSplitIdx).trim();
  const body = curlOutput.substring(headerSplitIdx).trim();
  // Parse the status line
  const statusLine = headers.split('\n')[0];
  const match = statusLine.match(/HTTP\/.* (\d{3}) (.*)/);
  const statusCode = match ? parseInt(match[1]) : null;
  // Parse headers into a dictionary
  const headersDict: { [key: string]: string } = {};

  for (const header of headers.split('\n').slice(1)) {
    const [key, value] = header.split(':', 2);
    headersDict[key.trim()] = value.trim();
  }

  return {
    statusCode,
    headers: headersDict,
    body: body.trim(),
  };
}

// Check if object1 is a subset of object2
function isSubsetOf(object1: any, object2: any): boolean {
  const objKeys1 = Object.keys(object1);

  for (var key of objKeys1) {
    const value1 = object1[key];
    const value2 = object2[key];

    const isObjects = isObject(value1) && isObject(value2);

    if (
      (isObjects && !isSubsetOf(value1, value2)) ||
      (!isObjects && value1 !== value2)
    ) {
      return false;
    }
  }

  return true;
}

function isObject(object: any): boolean {
  return object !== null && typeof object === 'object';
}

function addHttpToIpAddresses(text: string): string {
  const ipAddresses = text.match(
    /\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/g
  );
  if (ipAddresses) {
    for (const ip of ipAddresses) {
      if (!text.includes(`http://${ip}`) && !text.includes(`https://${ip}`)) {
        text = text.replace(new RegExp(`\\b${ip}\\b`, 'g'), `http://${ip}`);
      }
    }
  }
  return text;
}

export function getReproVals(): ReproVals {
  const reproConfig = vscode.workspace.getConfiguration('blinky.repro');
  return {
    buildCommand: reproConfig.get('buildCommand') || '',
    testCommand: reproConfig.get('testCommand') || '',
    expectedInstruction: reproConfig.get('expectedInstruction') || '',
    expectedStatus: reproConfig.get('expectedStatus') || '',
    expectedBody: reproConfig.get('expectedBody') || '',
  };
}

export function setReproVals(reproVals: ReproVals) {
  const reproConfig = vscode.workspace.getConfiguration('blinky.repro');
  reproConfig.update('buildCommand', reproVals.buildCommand, false);
  reproConfig.update('testCommand', reproVals.testCommand, false);
  reproConfig.update(
    'expectedInstruction',
    reproVals.expectedInstruction,
    false
  );
  reproConfig.update('expectedStatus', reproVals.expectedStatus, false);
  reproConfig.update('expectedBody', reproVals.expectedBody, false);
}

const MAX_NUM_RETRIES = 10;
export async function getShellHistoryPath(): Promise<string> {
  let numTries = 0;
  while (vscode.env.shell.length === 0 && numTries < MAX_NUM_RETRIES) {
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (vscode.env.shell.length === 0) {
    return '';
  }

  const spawnOutput = spawnSync(vscode.env.shell, ['-ic', 'echo $HISTFILE']);
  const histFilePath = spawnOutput.stdout.toString().trim();
  if (histFilePath.length > 0 && existsSync(histFilePath)) {
    return histFilePath;
  } else {
    return '';
  }
}

const SHELL_HISTORY_REGEX = /^(?::\s*\d+:\d+;)?(.+)$/;

const FILTERED_OUT_COMMANDS = [
  'cd',
  'ls',
  'echo',
  'pwd',
  'cat',
  'clear',
  'git status',
  'fc -AI',
];

export async function getRecentShellHistory(
  historyPath: string,
  limit: number = 10
): Promise<string[]> {
  if (historyPath.length === 0) {
    return [];
  }
  const document = await vscode.workspace.openTextDocument(historyPath);
  // Get the last 100 lines of the history file
  const end = document.lineCount;
  const start = Math.max(end - 100, 0);
  const commandList = [];

  let currentCommand = '';
  for (let i = start; i < end; i++) {
    const line = document.lineAt(i).text;
    const match = line.match(SHELL_HISTORY_REGEX);
    if (match) {
      const commandText = match[1];
      if (currentCommand.length > 0) {
        currentCommand += '\n';
      }
      currentCommand += commandText;
      if (!commandText.endsWith('\\')) {
        // remove escaped newlines
        currentCommand = currentCommand.replace(/\\\\\n/g, '');
        currentCommand = currentCommand.replace(/\\\n/g, '');
        // escape any backslashes
        currentCommand = escapeBackslash(currentCommand);
        if (
          currentCommand.length > 0 &&
          !FILTERED_OUT_COMMANDS.includes(currentCommand)
        ) {
          commandList.push(currentCommand);
        }
        currentCommand = '';
      }
    }
  }

  // Remove duplicates and return the most recent commands
  const commandSet = new Set(commandList.reverse());
  return Array.from(commandSet).slice(0, limit);
}

function escapeBackslash(input: string): string {
  return input.replace(/\\(.)/g, '$1');
}
