import OpenAI from 'openai';
import { Message } from '../agents/types';
import { CostLimitExceededError } from './../errors';

import * as vscode from 'vscode';
import { ChatCompletionChunk } from 'openai/resources/index.mjs';
import { Stream } from 'openai/streaming.mjs';
import { OutputChannel } from '../utils';

const openai = new OpenAI({
  apiKey: vscode.workspace.getConfiguration().get('openaiKey'), //process.env['OPENAI_API_KEY'], // This is the default and can be omitted
});

const azureOpenAI = new OpenAI({
  apiKey: vscode.workspace.getConfiguration().get('azure.openai.apiKey'),
  baseURL: vscode.workspace.getConfiguration().get('azure.openai.baseURL'),
  defaultQuery: { 'api-version': '2024-02-15-preview' },
  defaultHeaders: {
    'api-key': vscode.workspace.getConfiguration().get('azure.openai.apiKey'),
  },
});

export class BaseModel {
  numCalls: number = 0;
  maxCalls: number = 50;

  constructor(maxCalls: number = 50) {
    this.maxCalls = maxCalls;
  }

  async query(_history: Message[]): Promise<string | null> {
    // not implemented
    throw new Error('Not implemented');
  }

  async streamQuery(
    _history: Message[],
    _streamCallback: (accumulatedMessage: string) => void
  ): Promise<string | null> {
    // not implemented
    throw new Error('Not implemented');
  }
}

export class OpenAIModel extends BaseModel {
  model: string;
  module: OpenAI;

  constructor(model: string, module: OpenAI, maxCalls: number = 30) {
    super(maxCalls);
    this.model = model;
    this.module = module;
  }

  private _prepOpenAIFormat(
    history: Message[],
    temperature: number = 0.0,
    stream: boolean = false
  ): OpenAI.ChatCompletionCreateParams {
    return {
      messages: history.map((msg) => {
        return {
          role: msg.role as 'system' | 'user' | 'assistant',
          content: msg.content,
        };
      }),
      model: this.model,
      temperature: temperature,
      stream: stream,
    };
  }

  async query(history: Message[]): Promise<string | null> {
    if (this.numCalls >= this.maxCalls) {
      throw new CostLimitExceededError('Maximum model calls exceeded.');
    }
    const openAIMessages = this._prepOpenAIFormat(history);
    // Log most recent message
    OutputChannel.appendLine(
      `---Input Message---\n${
        openAIMessages.messages[openAIMessages.messages.length - 1].content
      }`
    );
    const chatCompletion: OpenAI.Chat.ChatCompletion =
      (await this.module.chat.completions.create(
        openAIMessages
      )) as OpenAI.Chat.ChatCompletion;
    this.numCalls += 1;
    OutputChannel.appendLine(
      `---Model Output---\n${chatCompletion.choices[0].message.content}`
    );
    return chatCompletion.choices[0].message.content;
  }

  async streamQuery(
    history: Message[],
    streamCallback: (accumulatedMessage: string) => void
  ): Promise<string | null> {
    if (this.numCalls >= this.maxCalls) {
      throw new CostLimitExceededError('Maximum model calls exceeded.');
    }
    const openAIMessages = this._prepOpenAIFormat(history, 0.0, true);
    // Log most recent message
    OutputChannel.appendLine(
      `---Input Message---\n${
        openAIMessages.messages[openAIMessages.messages.length - 1].content
      }`
    );
    const chatCompletion = (await this.module.chat.completions.create(
      openAIMessages
    )) as Stream<ChatCompletionChunk>;
    let accumulatedMessage = '';
    let prevLen = 0;
    let chunkLength = 1;
    for await (const chunk of chatCompletion) {
      accumulatedMessage += chunk.choices[0]?.delta?.content || '';
      if (accumulatedMessage.length > prevLen + chunkLength) {
        streamCallback(accumulatedMessage);
        prevLen = accumulatedMessage.length;
      }
    }
    this.numCalls += 1;
    OutputChannel.appendLine(`---Model Output---\n${accumulatedMessage}`);
    return accumulatedMessage;
  }
}

export function getOpenAIModel(
  model_id: string,
  apiKey: string,
  baseURL?: string // set if you want to use Azure OpenAI
): OpenAIModel {
  let oaiModule = null;
  if (apiKey && baseURL) {
    oaiModule = new OpenAI({
      apiKey: apiKey,
      baseURL: baseURL,
      defaultQuery: { 'api-version': '2024-02-15-preview' },
      defaultHeaders: {
        'api-key': apiKey,
      },
    });
  } else {
    oaiModule = new OpenAI({
      apiKey: apiKey,
    });
  }
  return new OpenAIModel(model_id, oaiModule);
}

export function getModel(model_type: string, model_id: string): BaseModel {
  if (model_type === 'openai') {
    return new OpenAIModel(model_id, openai);
  } else if (model_type === 'azure-openai') {
    return new OpenAIModel(model_id, azureOpenAI);
  } else {
    throw new Error(`Model type ${model_type} not supported`);
  }
}
