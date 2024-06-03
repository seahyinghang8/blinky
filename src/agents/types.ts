import { Config } from '../config/types';
import { Toolbox } from '../tools/toolbox';
import { EditMetadata } from '../tools/edit';
import { BaseModel } from '../model/model';

export interface Action {
  toolName: string;
  params: string[];
}

export interface ForwardStep {
  thought: string;
  actions: Action[];
  output?: string;
}

export interface State {
  current_file?: string;
  open_files?: string[];
  working_dir?: string;
}

export interface Message {
  id?: string;
  role: string;
  content: string;
  thought?: string;
  actions?: Action[];
  is_demo?: boolean;
  editInfo?: Record<string, EditMetadata[]>;
  didActionsFail?: boolean;
}

export interface IAgent {
  initialize: (toolbox: Toolbox, model: BaseModel) => Promise<void>;
  setTaskContext: (taskContext: TaskContext) => void;
  forward: (
    state: State,
    streamCallback: (accumulatedMessage: string) => void
  ) => Promise<ForwardStep | null>;
  setObservation: (observation: string | null, userMessages?: string) => void;
  updateEditInfo: (editInfo: Record<string, EditMetadata[]>) => void;
  updateDidActionsFail: (failed: boolean) => void;
  undo: (...args: any[]) => Promise<string>;
  config: Config;
  history: Message[];
}

export interface TaskContext {
  issue: string;
  userMessage: string;
  files: File[];
}

export interface File {
  name: string;
  is_open: boolean;
}

export interface APITaskContext extends TaskContext {
  endpoint: string;
  request: {
    method: 'GET' | 'POST' | 'PUT' | 'DELETE';
    headers: { [key: string]: string };
    body: { [key: string]: string };
  };
  expectedResponse: {
    status: number;
    body: { [key: string]: string };
  };
}
