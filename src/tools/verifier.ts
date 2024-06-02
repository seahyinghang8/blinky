import { type ChildProcess, spawn } from 'child_process';
import { StringDecoder } from 'string_decoder';
import { getRootUri } from './utils';
import treeKill from 'tree-kill';
import { escapeRegExpCharacters } from './ripgrep/strings';
import { OutputChannel } from '../utils';

export enum VerificationStepType {
  LocalProcess = 'local process',
  HttpRequest = 'http',
}

export interface ILocalProcessStepArgs {
  type: VerificationStepType.LocalProcess;
  command: string;
  // cwd will default to the first project root folder
  cwd?: string;
  processReadyKeywords?: string[];
  processFailedKeywords?: string[];
  inactivityTimeout?: number;
  processTimeout?: number;

  defaultLogTextFilters?: string;
  defaultLogTypeFilters?: LogType[];

  evaluateOutput?: (a: string) => { logs: string; pass: boolean };
}

export interface IHttpRequestStepArgs {
  type: 'http';
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  endpoint: string;
  evaluateResponse: (a: Response) => Promise<{ logs: string; pass: boolean }>;
  headers?: Record<string, string>;
  body?: any;
  requestTimeout?: number;
  // output of evaluate response will be appended to the log
}

export type VerificationStepArgs = ILocalProcessStepArgs | IHttpRequestStepArgs;

export class Verifier {
  private stepOptions: VerificationStepArgs[] = [];

  hasSteps(): boolean {
    return this.stepOptions.length > 0;
  }

  async verify(): Promise<{ logs: string; pass: boolean }> {
    // steps will be executed sequentially in the order of the stepArgs.
    // if any of the steps fail to reach the ready state, the verifier would fail
    // and return the error prematurely.

    let stepFailed = false;
    const steps = [];

    for (const option of this.stepOptions) {
      let step;
      switch (option.type) {
        case VerificationStepType.LocalProcess: {
          const cwd = option.cwd ?? getRootUri().fsPath;
          step = new LocalProcessStep(
            option.command,
            cwd,
            option.evaluateOutput,
            {
              readyMatchRegex: new RegExp(
                (
                  option.processReadyKeywords?.map((text) =>
                    escapeRegExpCharacters(text)
                  ) ?? DEFAULT_PROCESS_READY_REGEX.map((regex) => regex.source)
                ).join('|')
              ),
              failureMatchRegex: new RegExp(
                (
                  option.processFailedKeywords?.map((text) =>
                    escapeRegExpCharacters(text)
                  ) ?? DEFAULT_PROCESS_FAILED_REGEX.map((regex) => regex.source)
                ).join('|')
              ),
              inactivityTimeout: option.inactivityTimeout,
              processTimeout: option.processTimeout,
              defaultLogTextFilters: option.defaultLogTextFilters,
              defaultLogTypeFilters: option.defaultLogTypeFilters,
            }
          );
          break;
        }
        case VerificationStepType.HttpRequest: {
          step = new HttpStep(
            option.method,
            option.endpoint,
            option.evaluateResponse,
            {
              headers: option.headers,
              body: option.body,
              requestTimeout: option.requestTimeout,
            }
          );
          break;
        }
        default: {
          throw new Error(`Invalid step type: ${option.type}`);
        }
      }

      step.start();
      steps.push(step);
      if (!(await step.isReady())) {
        stepFailed = true;
        break;
      }
    }

    let logs = '';
    for (const step of steps) {
      await step.stop();
      logs += `<log>\n${step.getLogs()}\n</log>\n\n`;
    }
    await new Promise((rs) => setTimeout(rs, 5000));
    return { logs, pass: !stepFailed };
  }

  setVerificationSteps(stepOptions: VerificationStepArgs[]) {
    this.stepOptions = stepOptions;
  }
}

interface IVerificationStep {
  type: VerificationStepType;
  start: () => void;
  /*
    Ready indicates that the next verification step can be called
    isReady will wait until the program is ready and then return true
    (or false if the program will never be ready)
    - Returns false immediately if run() is not called
    - Returns false if the step has already failed
  */
  isReady: () => Promise<boolean>;
  getLogs: () => string;
  stop: () => Promise<void>;
}

// Local Process Implementation

export enum LogType {
  STDOUT = 0,
  STDERR = 1,
  ERROR = 2,
}

const DEFAULT_INACTIVITY_TIMEOUT = 30000;
const DEFAULT_GRACEFUL_EXIT_TIMEOUT = 10000;
const DEFAULT_PROCESS_TIMEOUT = 120000;
const DEFAULT_PROCESS_READY_REGEX: RegExp[] = [
  /Press CTRL\+C to shut down\./, // .NET
  /\(Press CTRL\+C to quit\)/, // Flask / FastAPI
  /Quit the server with CONTROL\-C\./, // Django
  /[R|r]eady in\s*\d*\s*m?s/, // NextJS / vite
  /webpack compiled successfully/, // Webpack
];
const DEFAULT_PROCESS_FAILED_REGEX: RegExp[] = [
  /Syntax\s*[E|e]rror/,
  /Import\s*[E|e]rror/,
  /Module\s*[E|e]rror/,
  /Failed to compile/,
];

interface ProcessStepOptions {
  // Regex to match stdout or stderr to indicate the process is ready
  // If not provided, process assumes to be ready if the process exits with exit code 0
  readyMatchRegex?: RegExp;
  // Regex to match stdout or stderr to indicate the process has failed and NOT ready
  failureMatchRegex?: RegExp;
  // If there is no new outputs in stdout or stderr after inactivity timeout,
  // process will be marked as success and ready
  inactivityTimeout?: number;
  // Process will be killed after this timeout if it does not exit
  processTimeout?: number;

  defaultLogTextFilters?: string;
  defaultLogTypeFilters?: LogType[];
  gracefulExitTimeout?: number;
}

class LocalProcessStep implements IVerificationStep {
  public type = VerificationStepType.LocalProcess;
  private logs: [string, LogType][] = [];
  private proc?: ChildProcess;
  private stringDecoder: StringDecoder;
  private readyMatchRegex?: RegExp;
  private failureMatchRegex?: RegExp;
  private inactivityTimeout: number;
  private gracefulExitTimeout?: number;
  private processTimeout?: number;
  private evaluateOutput?: (a: string) => { logs: string; pass: boolean };
  private isReadyPromise?: Promise<boolean>;
  private readyPromiseResolved: boolean = false;
  private isReadyResolve?: (isReady: boolean) => void;
  private defaultLogTypeFilters: LogType[];
  private defaultLogTextFilters: string;
  private isExitedPromise?: Promise<void>;
  private isExitedResolve?: () => void;

  constructor(
    private command: string,
    private cwd: string,
    evaluateOutput?: (a: string) => { logs: string; pass: boolean },
    options?: ProcessStepOptions
  ) {
    this.stringDecoder = new StringDecoder();
    this.readyMatchRegex = options?.readyMatchRegex;
    this.failureMatchRegex = options?.failureMatchRegex;
    this.inactivityTimeout =
      options?.inactivityTimeout ?? DEFAULT_INACTIVITY_TIMEOUT;
    this.defaultLogTextFilters = options?.defaultLogTextFilters ?? '';
    this.defaultLogTypeFilters = options?.defaultLogTypeFilters ?? [];
    this.gracefulExitTimeout =
      options?.gracefulExitTimeout ?? DEFAULT_GRACEFUL_EXIT_TIMEOUT;
    this.processTimeout = options?.processTimeout ?? DEFAULT_PROCESS_TIMEOUT;
    this.evaluateOutput = evaluateOutput;
  }

  start() {
    this.proc = spawn(this.command, {
      cwd: this.cwd,
      shell: true,
      timeout: this.processTimeout,
    });

    this.isReadyPromise = new Promise((resolve) => {
      this.readyPromiseResolved = false;
      this.isReadyResolve = resolve;
    });

    this.isExitedPromise = new Promise((resolve) => {
      this.isExitedResolve = resolve;
    });

    this.proc.on('error', (e: { message: any }) => {
      console.error(e);
      this.logs.push([e.message, LogType.ERROR]);
      this.setReadyState(false);
    });

    this.proc.stdout?.on('data', (output) => {
      this.handleOutput(output, LogType.STDOUT);
    });

    this.proc.stderr?.on('data', (output) => {
      this.handleOutput(output, LogType.STDERR);
    });

    this.proc.once('exit', (code: number) => {
      if (!this.readyMatchRegex) {
        this.setReadyState(code === 0);
      } else {
        this.setReadyState(false);
      }
      if (this.isExitedResolve) {
        this.isExitedResolve();
      }
    });
  }

  async stop() {
    if (this.proc?.pid) {
      treeKill(this.proc.pid, 'SIGINT');
      // If the process does not exit gracefully, kill it after a timeout
      setTimeout(() => {
        treeKill(this.proc!.pid!, 'SIGKILL');
      }, this.gracefulExitTimeout);
    }
    if (this.isExitedPromise) {
      await this.isExitedPromise;
    }
  }

  async isReady(): Promise<boolean> {
    if (!this.isReadyPromise) {
      return false;
    }
    return this.isReadyPromise;
  }

  getLogs(
    textFilters?: string,
    typeFilters?: LogType[],
    maxLogChars: number = 2500,
    maxLogLineChars: number = 1000 // Ignore logs that are too long
  ): string {
    const commandStr = `$ ${this.command}`;
    let filteredLogs = this.logs;
    textFilters = textFilters ?? this.defaultLogTextFilters;
    typeFilters = typeFilters ?? this.defaultLogTypeFilters;
    if (textFilters.length > 0 || typeFilters.length > 0) {
      filteredLogs = filteredLogs.filter(
        ([text, type]) =>
          (textFilters.length > 0 && text.match(textFilters)) ||
          (typeFilters.length > 0 && typeFilters.includes(type))
      );
    }
    // filter lines by character length
    let logsCombined = filteredLogs
      .map(([text, _]) => {
        if (textFilters.length > 0 || typeFilters.length > 0) {
          // if there are type/text filters applied, return the text as is
          return text;
        }
        const filteredText = text
          .split('\n') // Split the text into lines
          .filter((line) => line.length <= maxLogLineChars) // Filter lines longer than 100 characters
          .join('\n'); // Join the filtered lines back into a single string
        return filteredText; // Return a new object with the filtered text
      })
      .join('');
    // keep last maxLogChars characters
    if (logsCombined.length > maxLogChars) {
      logsCombined = '...' + logsCombined.slice(-maxLogChars);
    }
    let commandAndLogs = `${commandStr}\n${logsCombined}`;
    if (this.evaluateOutput) {
      let outputLogs = this.logs.map(([text, _]) => text).join('');
      const { logs } = this.evaluateOutput(outputLogs);
      commandAndLogs += `\n---- Evaluation ----\n${logs}`;
    }
    return commandAndLogs;
  }

  private setReadyState(isReady: boolean) {
    if (this.isReadyResolve) {
      this.isReadyResolve(isReady);
      this.readyPromiseResolved = true;
    }
  }

  private handleOutput(output: Buffer | string, logType: LogType) {
    const outputStr =
      typeof output === 'string' ? output : this.stringDecoder.write(output);
    this.logs.push([outputStr, logType]);
    const logLength = this.logs.length;

    if (!this.readyPromiseResolved) {
      if (this.readyMatchRegex && outputStr.match(this.readyMatchRegex)) {
        this.setReadyState(true);
      } else if (
        this.failureMatchRegex &&
        outputStr.match(this.failureMatchRegex)
      ) {
        this.setReadyState(false);
      } else {
        setTimeout(() => {
          if (logLength === this.logs.length) {
            // Logs have no activity for the entire inactivity duration
            this.setReadyState(true);
          }
        }, this.inactivityTimeout);
      }
    }
  }
}

const DEFAULT_REQUEST_TIMEOUT = 10000;

interface HttpStepOptions {
  headers?: Record<string, string>;
  body?: string;
  requestTimeout?: number;
}

class HttpStep implements IVerificationStep {
  public type = VerificationStepType.HttpRequest;
  private evaluationLogs?: string;
  private responseLogs: string = '';
  private isReadyPromise?: Promise<boolean>;
  private isReadyResolve?: (isReady: boolean) => void;
  private headers?: Record<string, string>;
  private body?: any;
  private timeout: number;

  constructor(
    private method: string,
    private endpoint: string,
    private evaluateOutput: (
      a: Response
    ) => Promise<{ logs: string; pass: boolean }>,
    options?: HttpStepOptions
  ) {
    this.headers = options?.headers;
    this.body = options?.body;
    this.timeout = options?.requestTimeout ?? DEFAULT_REQUEST_TIMEOUT;
  }

  start() {
    this.isReadyPromise = new Promise((resolve) => {
      this.isReadyResolve = resolve;
    });

    const options: RequestInit = {
      method: this.method,
      headers: this.headers,
      body: JSON.stringify(this.body),
      signal: AbortSignal.timeout(this.timeout),
    };

    fetch(this.endpoint, options)
      .then(async (response) => {
        const clonedResponse = response.clone();
        this.responseLogs += `${response.status} (${response.statusText})`;
        this.responseLogs += `\n${await response.text()}`;
        const { logs, pass } = await this.evaluateOutput(clonedResponse);
        this.evaluationLogs = logs;
        this.setReadyState(pass);
      })
      .catch((e) => {
        this.responseLogs += `\nError: ${e}`;
        this.setReadyState(false);
      });
  }

  async stop() {}

  async isReady(): Promise<boolean> {
    if (!this.isReadyPromise) {
      return false;
    }
    return this.isReadyPromise;
  }

  getLogs(): string {
    let requestStr = `${this.method} ${this.endpoint}`;
    if (this.headers) {
      for (const [key, value] of Object.entries(this.headers)) {
        requestStr += `\n${key}: ${value}`;
      }
    }
    if (this.body) {
      requestStr += `\nBody: ${JSON.stringify(this.body)}`;
    }

    const logStr =
      '---- HTTP Request ----\n' +
      requestStr +
      '\n---- Response ----\n' +
      this.responseLogs +
      (this.evaluationLogs
        ? '\n---- Evaluation ----\n' + this.evaluationLogs
        : '');
    return logStr;
  }

  private setReadyState(isReady: boolean) {
    if (this.isReadyResolve) {
      this.isReadyResolve(isReady);
    }
  }
}
