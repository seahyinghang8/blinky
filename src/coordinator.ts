import path from 'path';
import { thoughtActionParser } from './agents/parsers';
import { IAgent } from './agents/types';
import { DemonstrationStep } from './config/types';
import { getOpenAIModel } from './model/model';
import type { ChatSidebarProvider } from './sidebar/sidebarProvider';
import { redoFn } from './tools/edit';
import { Toolbox } from './tools/toolbox';
import { DiffState, getHistoricalDiff, getRootUri } from './tools/utils';
import { Verifier } from './tools/verifier';
import {
  OutputChannel,
  ReproVals,
  convertReproValsToVerificationSteps,
  convertTrajectoryToMessages,
  getRecentShellHistory,
  getReproVals,
  getShellHistoryPath,
  interpolate,
  setReproVals,
} from './utils';
import { InterruptError } from './errors';

import * as vscode from 'vscode';

/* 
    Coordinator will host and run the agent loop
    Coordinator will facilitate communication between:
    - Agent <-> UI
    - Agent <-> Tools
*/
export class Coordinator {
  private loopIsRunning: boolean = false;
  private breakLoop: boolean = true;
  private trajectory: DemonstrationStep[] = [];
  private userFirstMessage: string = '';
  private pendingUserMessage: string[] = [];
  private initialVerifierContext: string = '';
  private historicalDiff: Record<string, DiffState> = {};
  private diffApplied: boolean = false;
  private agentInitialized: boolean = false;

  // dependencies will be provided through the constructor
  constructor(
    private agent: IAgent,
    private toolbox: Toolbox,
    private verifier: Verifier,
    private sideBarProvider: ChatSidebarProvider
  ) {}

  async initialize() {
    // Register the request handler for the sidebar
    this.sideBarProvider.registerRequestHandler('messages', async () => {
      return convertTrajectoryToMessages(
        this.trajectory,
        this.pendingUserMessage
      );
    });
    this.sideBarProvider.registerRequestHandler('isRunning', async () => {
      return !this.breakLoop;
    });
    this.sideBarProvider.registerRequestHandler('diffApplied', async () => {
      return this.diffApplied;
    });
    this.sideBarProvider.registerRequestHandler('hasStarted', async () => {
      return this.trajectory.length > 0;
    });
    this.sideBarProvider.registerRequestHandler('stop', async () => {
      this.endLoop();
      return true;
    });
    this.sideBarProvider.registerRequestHandler('start', async () => {
      this.startLoop();
      return true;
    });
    this.sideBarProvider.registerRequestHandler('undo', async (id) => {
      try {
        await this.agent.undo(id || undefined, true, true);
        this.diffApplied = false;
      } catch (e) {
        this.sideBarProvider.sendUpdate('errorMsg', e);
        console.error(e);
        return false;
      }
      return true;
    });
    this.sideBarProvider.registerRequestHandler('redo', async () => {
      try {
        await redoFn(this.historicalDiff);
        this.diffApplied = true;
      } catch (e) {
        this.sideBarProvider.sendUpdate('errorMsg', e);
        console.error(e);
        return false;
      }
      return true;
    });
    this.sideBarProvider.registerRequestHandler(
      'updateVerificationSteps',
      async (reproVals: ReproVals) => {
        if (Object.values(reproVals).every((val) => val.length === 0)) {
          return true;
        }
        setReproVals(reproVals);
        this.verifier.setVerificationSteps(
          convertReproValsToVerificationSteps(reproVals)
        );
        return true;
      }
    );
    this.sideBarProvider.registerRequestHandler(
      'userMessage',
      async (message) => {
        if (
          this.userFirstMessage.length === 0 &&
          this.trajectory.length === 0
        ) {
          this.userFirstMessage = message;
          this.trajectory.push({
            role: 'user',
            content: message,
            thought: message,
          });
          this.trajectoryUpdated();
          this.startLoop();
        } else {
          if (!this.loopIsRunning) {
            this._updateMessageAfterPauseOrDone(message);
            this.startLoop();
            return true;
          }
          // Add user message to pending messages
          this.pendingUserMessage.push(message);
          this.trajectoryUpdated();
        }
        return true;
      }
    );
    this.sideBarProvider.registerRequestHandler('getReproVals', async () => {
      return getReproVals();
    });
    this.sideBarProvider.registerRequestHandler(
      'openReproSettings',
      async () => {
        vscode.commands.executeCommand(
          'workbench.action.openWorkspaceSettings',
          'blinky.repro'
        );
        return true;
      }
    );
    const shellHistoryFilepathPromise = getShellHistoryPath();
    shellHistoryFilepathPromise.then((shellHistoryFilepath) => {
      if (shellHistoryFilepath.length === 0) {
        return;
      }
      const dirPath = path.dirname(shellHistoryFilepath);
      const fileName = path.basename(shellHistoryFilepath);
      // Watch the shell history file for changes
      const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(dirPath, fileName),
        true,
        false,
        true
      );
      watcher.onDidChange(async () => {
        const shellHistory = await getRecentShellHistory(shellHistoryFilepath);
        this.sideBarProvider.sendUpdate('shellHistory', shellHistory);
      });
    });
    this.sideBarProvider.registerRequestHandler('shellHistory', async () => {
      const shellHistoryFilepath = await shellHistoryFilepathPromise;
      const history = await getRecentShellHistory(shellHistoryFilepath);
      return history;
    });
    this.sideBarProvider.registerRequestHandler(
      'pushActiveTerminalShellHistory',
      async () => {
        vscode.window.activeTerminal?.sendText('fc -AI');
        return true;
      }
    );
    // Initialize the toolbox with the verifier
    await this.toolbox.initialize(
      this.verifier,
      this.agent.undo.bind(this.agent)
    );
    // Initialize the agent if the API key is set
    if (this._checkAPIKey()) {
      const model = this._getModel();
      await this.agent.initialize(this.toolbox, model!);
      this.agentInitialized = true;
    }
  }

  async resetProgress() {
    this.endLoop();
    this.agent.undo();
    this.agentInitialized = false;
    this.trajectory = [];
    this.breakLoop = true;
    this.userFirstMessage = '';
    this.pendingUserMessage = [];
    this.initialVerifierContext = '';
    this.historicalDiff = {};
    await this.initialize();
    this.trajectoryUpdated();
    return true;
  }

  async setupAgentContext() {
    if (this.initialVerifierContext.length === 0) {
      if (this.verifier.hasSteps()) {
        if (this.trajectory.length === 0) {
          const firstTrajStep: DemonstrationStep = {
            role: 'user',
            content: 'No additional context provided',
            thought: 'No additional context provided',
          };
          this.trajectory.push(firstTrajStep);
        }
        this.trajectory[0].actions = [{ toolName: 'Verify', params: [] }];
        this.trajectoryUpdated();

        this.initialVerifierContext = (await this.verifier.verify()).logs;

        this.trajectory[0].observations = [this.initialVerifierContext];
        this.trajectoryUpdated();
      } else {
        this.initialVerifierContext = '';
      }
    }

    this.agent.setTaskContext({
      issue: this.userFirstMessage + '\n\n' + this.initialVerifierContext,
      userMessage: this.userFirstMessage,
      files: [],
    });
  }

  _checkAPIKey() {
    // Check if the API key is set
    const oaiKey = vscode.workspace.getConfiguration().get('openaiKey');
    const azureOaiKey = vscode.workspace
      .getConfiguration()
      .get('azure.openai.apiKey');
    const azureBaseUrl = vscode.workspace
      .getConfiguration()
      .get('azure.openai.baseURL');
    if (oaiKey || (azureOaiKey && azureBaseUrl)) {
      return true;
    }
    return false;
  }

  _getModel() {
    const model_type = 'gpt-4-turbo';
    const oaiKey: string =
      vscode.workspace.getConfiguration().get('openaiKey') || '';
    const azureOaiKey: string =
      vscode.workspace.getConfiguration().get('azure.openai.apiKey') || '';
    const azureBaseUrl: string =
      vscode.workspace.getConfiguration().get('azure.openai.baseURL') || '';
    if (azureOaiKey && azureBaseUrl) {
      return getOpenAIModel(model_type, azureOaiKey, azureBaseUrl);
    }
    return getOpenAIModel(model_type, oaiKey);
  }

  _updateMessageAfterPauseOrDone(userMsg: string) {
    let message = userMsg;
    if (Object.keys(this.historicalDiff).length > 0) {
      if (this.diffApplied) {
        message = interpolate(this.agent.config.post_applied_diff_template, {
          userMsg: userMsg,
        });
      } else {
        message = interpolate(this.agent.config.post_reverted_diff_template, {
          userMsg: userMsg,
        });
      }
    }
    this.agent.setObservation(message);
    this.trajectory.push({
      role: 'user',
      content: userMsg,
      thought: userMsg,
      observations: [message],
    });
    // Send update to the sidebar
    this.trajectoryUpdated();
  }

  async _updateModelKeysAndInitAgent() {
    let model;
    const apiKey = await vscode.window.showInputBox({
      value: '',
      valueSelection: [2, 4],
      ignoreFocusOut: true,
      placeHolder: 'OpenAI or Azure OpenAI API Key',
    });
    if (apiKey === undefined || apiKey.length === 0) {
      return;
    }
    let baseURL;
    if (apiKey.length <= 32) {
      // Hack to check if the user is using Azure OpenAI
      baseURL = await vscode.window.showInputBox({
        value: '',
        valueSelection: [2, 4],
        ignoreFocusOut: true,
        placeHolder: 'Azure OpenAI Base URL',
      });
      if (baseURL === undefined || baseURL.length === 0) {
        return;
      }
    }
    if (apiKey && baseURL) {
      const azureOpenAIConfig =
        vscode.workspace.getConfiguration('azure.openai');
      azureOpenAIConfig.update('apiKey', apiKey, true);
      azureOpenAIConfig.update('baseURL', baseURL, true);
      model = getOpenAIModel('gpt-4-turbo', apiKey, baseURL);
    } else {
      vscode.workspace.getConfiguration().update('openaiKey', apiKey, true);
      model = getOpenAIModel('gpt-4-turbo', apiKey);
    }
    await this.agent.initialize(this.toolbox, model);
    this.agentInitialized = true;
  }

  async startLoop() {
    if (!this.agentInitialized) {
      // API keys were not set, ask the user to set them
      await this._updateModelKeysAndInitAgent();
    }
    if (!this.agentInitialized) {
      // API keys were not set, return
      vscode.window.showErrorMessage('Set your OpenAI API keys to start');
      this.sideBarProvider.sendUpdate(
        'errorMsg',
        'Set your OpenAI API keys to start'
      );
      return;
    }
    this.breakLoop = false;
    this.sideBarProvider.sendUpdate('isRunning', !this.breakLoop);
    this.setupAgentContext().then(() => {
      // Do not start multiple loops at the same time
      if (!this.loopIsRunning) {
        this.loop();
      }
    });
  }

  endLoop() {
    this.breakLoop = true;
  }

  loopEnded() {
    this.breakLoop = true;
    this.sideBarProvider.sendUpdate('isRunning', false);
  }

  async loop() {
    this.loopIsRunning = true;
    let exitReason = '';
    let finalSummary = '';
    let agentEnded = false; // track if agent ended the loop
    while (!this.breakLoop) {
      let step;
      try {
        const emptyStreamTrajStep = {
          id: this.trajectory.length.toString(),
          role: 'agent',
          text: '',
          actions: '',
        };
        this.sideBarProvider.sendUpdate(
          'streamingMessage',
          emptyStreamTrajStep
        );
        try {
          step = await this.agent.forward({}, this.streamCallback.bind(this));
        } catch (e) {
          if (e === InterruptError) {
            break;
          }
          throw e;
        }
      } catch (e: any) {
        const err: Error = e;
        exitReason = err.message;
        this.sideBarProvider.sendUpdate('errorMsg', exitReason);
        this.breakLoop = true;
        break;
      }
      if (step === null) {
        break;
      }
      OutputChannel.appendLine('STEP ' + JSON.stringify(step));
      if (step.actions[0].toolName === this.agent.config.done_function) {
        finalSummary = step.thought;
        agentEnded = true;
        break;
      }
      // Update trajectory
      const trajIdx =
        this.trajectory.push({
          role: 'agent',
          content: step.output || '',
          thought: step.thought,
          actions: step.actions,
        }) - 1;
      const { observations, editInfo, failed } =
        await this.toolbox.executeActions(step.actions);
      let observationStr = observations.join('\n----------------\n');
      // Update the agent with the observations
      // Append pending user messages to the agent's observations
      if (this.pendingUserMessage.length > 0) {
        observationStr += '\n----------------\nFeedback from the user:\n';
        observationStr += this.pendingUserMessage.join('\n');
        for (const message of this.pendingUserMessage) {
          this.trajectory.push({
            role: 'user',
            content: message,
            thought: message,
          });
        }
        this.pendingUserMessage = [];
        this.trajectoryUpdated();
      }
      this.agent.setObservation(observationStr);
      this.agent.updateEditInfo(editInfo);
      this.agent.updateDidActionsFail(failed);
      // Updated trajectory with observations
      this.trajectory[trajIdx].observations = observations;
      // Send update to the sidebar
      this.trajectoryUpdated();
    }
    if (exitReason.length > 0) {
      this.trajectory.push({
        role: 'agent',
        content: exitReason,
        thought: exitReason,
        actions: [{ toolName: 'Exit', params: [] }],
      });
    } else if (agentEnded) {
      // Agent ended the loop.
      this.historicalDiff = await getHistoricalDiff(this.agent.history);
      if (Object.keys(this.historicalDiff).length === 0) {
        this.trajectory.push({
          role: 'agent',
          content: finalSummary || 'Completed. No changes were made',
          thought: finalSummary || 'Completed. No changes were made',
          actions: [{ toolName: 'Done', params: [] }],
        });
        this.diffApplied = false; // no diff to apply.
      } else {
        this.trajectory.push({
          role: 'agent',
          content: finalSummary || 'Session ended',
          thought: finalSummary || 'Session ended',
          actions: [{ toolName: 'Exit', params: [] }],
          wsDiffs: {
            wsRoot: getRootUri().path,
            diffs: this.historicalDiff,
          },
        });
        this.diffApplied = false;
      }
    }
    // undo changes by default.
    await this.agent.undo(undefined, true, true);
    // Send update to the sidebar
    this.trajectoryUpdated();
    this.loopIsRunning = false;
    this.loopEnded();
  }

  private trajectoryUpdated() {
    this.sideBarProvider.sendUpdate(
      'messages',
      convertTrajectoryToMessages(this.trajectory, this.pendingUserMessage)
    );
  }

  private streamCallback(accumulatedMessage: string) {
    if (this.breakLoop) {
      throw InterruptError;
      return;
    }
    const step = thoughtActionParser(accumulatedMessage, true);
    const trajStep = {
      id: this.trajectory.length.toString(),
      role: 'agent',
      text: step.thought,
      // keep params empty and just chuck it into the output
      actions: step.actions.map((action) => ({
        toolName: action.toolName,
        params: [],
      })),
      // the params go to output.
      observations: step.actions.map((action) => action.params.join('\n')),
    };
    this.sideBarProvider.sendUpdate('streamingMessage', trajStep);
  }
}
