import { IAgent, TaskContext } from './types';
import { OutputChannel, interpolate } from './../utils';
import { Message, ForwardStep, State } from './types';
import { Config } from '../config/types';
import { FormatError, RuntimeError } from './../errors';
import { serializeDemonstrations, serializeTools } from './serialize';
import { BaseModel } from '../model/model';
import { Toolbox } from '../tools/toolbox';
import { revertToPreviousState } from '../tools/edit';
import { pruneHistory } from './history';

export class VanillaAgent implements IAgent {
  history: Message[] = [];
  config: Config;
  taskContext: TaskContext = {
    issue: '',
    userMessage: '',
    files: [],
  };
  model: BaseModel | null = null;
  currentObservation: string | null = '';
  toolbox: Toolbox | null = null;
  idTracker: number = 0;

  // Normal signature with defaults
  constructor(config: Config) {
    this.config = config;
  }

  async initialize(toolbox: Toolbox, model: BaseModel) {
    // Start with system prompt
    this.toolbox = toolbox;
    this.model = model;
  }

  initHistory(taskContext: TaskContext) {
    // Start with system prompt
    this.history = [
      {
        role: 'system',
        content: interpolate(this.config.system_template, {
          function_docs: serializeTools(this.toolbox!),
          ...this.config.auxillary_vars,
          ...taskContext,
        }),
      },
    ];
    OutputChannel.appendLine('---System Prompt---');
    OutputChannel.appendLine(this.history[0].content);
    // Add demonstration if available
    if (this.config.demonstrations && this.config.demonstration_template) {
      this.history.push({
        role: 'user',
        content: interpolate(this.config.demonstration_template, {
          demonstrations: serializeDemonstrations(this.config.demonstrations),
        }),
        is_demo: true,
      });
    }
  }

  setTaskContext(taskContext: TaskContext) {
    this.taskContext = taskContext;
  }

  async forward(
    state: State,
    streamCallback?: (accumulatedMessage: string) => void
  ): Promise<ForwardStep> {
    if (this.history.length === 0) {
      this.initHistory(this.taskContext);
    }
    const output = await this.forwardModel(state, streamCallback);
    const step = await this.checkFormatAndRequery(output);
    this.history.push({
      role: 'assistant',
      content: step.output || '',
      thought: step.thought,
      actions: step.actions,
    });
    return step;
  }

  async queryModel(
    history: Message[],
    streamCallback?: (accumulatedMessage: string) => void
  ): Promise<string> {
    if (this.model === null) {
      throw new RuntimeError('Model not initialized');
    }
    // Query the model with the history
    let response: string | null = null;
    let prunedHistory = await pruneHistory([...history]);
    if (streamCallback) {
      response = await this.model.streamQuery(prunedHistory, streamCallback);
    } else {
      response = await this.model.query(prunedHistory);
    }
    if (response === null) {
      response = '';
    }
    return response;
  }

  async forwardModel(
    state: State,
    streamCallback?: (accumulatedMessage: string) => void
  ): Promise<string> {
    // Implement forward pass of the agent
    let templates: string[] = [];
    if (
      this.history[this.history.length - 1].role === 'system' ||
      this.history[this.history.length - 1].is_demo === false
    ) {
      templates = [this.config.instance_template];
    } else if ((this.currentObservation || '').trim() === '') {
      templates = [
        this.config.state_template,
        this.config.next_step_no_output_template,
      ];
    } else {
      templates = [this.config.state_template, this.config.next_step_template];
    }
    const currentId = this.idTracker;
    const messages: string[] = templates.map((template) => {
      return interpolate(template, {
        observation: this.currentObservation,
        stateId: `${currentId}`,
        ...this.taskContext,
        ...state,
      });
    });
    this.history.push({
      role: 'user',
      content: messages.join('\n'),
      id: `${currentId}`,
    });
    this.idTracker += 1;
    return await this.queryModel(this.history, streamCallback);
  }

  async retryAfterFormatFail(output: string): Promise<string> {
    // Retry after format fail
    this.history.push({
      role: 'assistant',
      content: output,
    });
    const temp_history: Message[] = this.history.concat([
      { role: 'assistant', content: output },
      {
        role: 'user',
        content: this.config.format_error_template,
      },
    ]);
    return await this.queryModel(temp_history);
  }

  async checkFormatAndRequery(output: string): Promise<ForwardStep> {
    // Check format and requery
    let fails: number = 0;
    let result: ForwardStep = {
      thought: '',
      actions: [{ toolName: '', params: [] }],
    };
    while (fails < 3) {
      try {
        result = this.config.parseFn(output);
      } catch (e) {
        if (e instanceof FormatError) {
          output = await this.retryAfterFormatFail(output);
          fails += 1;
          continue;
        } else {
          throw e;
        }
      }
      return result;
    }
    throw new FormatError('Failed to Parse Model Output');
  }

  setObservation(observation: string | null, userMessages?: string) {
    this.currentObservation = observation;
    // Add new user messages to the task context
    if (userMessages) {
      this.taskContext.userMessage += '\n' + userMessages;
    }
  }

  updateEditInfo(editInfo: Record<string, any>) {
    this.history[this.history.length - 1].editInfo = editInfo;
  }

  updateDidActionsFail(fail: boolean) {
    this.history[this.history.length - 1].didActionsFail = fail;
  }

  async undo(
    id?: string,
    keepFinalState: boolean = false,
    keepHistory = false
  ): Promise<string> {
    // Undo all the edits or to state id if provided
    // If keepFinalState is true, then the final state is not undone (useful for keeping the message that triggered the undo)
    if (this.history.length === 0) {
      return `No history to undo!`;
    }
    let curIdx = this.history.length - 1 - (keepFinalState ? 1 : 0);
    while (this.history.length > 0 && curIdx >= 0) {
      const last = this.history[curIdx];
      if (last?.role === 'user' && id && last?.id === id.toString()) {
        break;
      }
      curIdx -= 1;
      try {
        await revertToPreviousState(last?.editInfo || {});
      } catch (e) {
        OutputChannel.appendLine(`Error in undo, but continuing: ${e}`);
      }
      if (!keepHistory) {
        this.history.pop();
      }
    }
    return `Undid successfully!`;
  }
}
