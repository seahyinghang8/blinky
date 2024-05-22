import { vscode } from './vscode';

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (reason: any) => void;
}

const DEFAULT_REQUEST_TIMEOUT = 5000;

class Backend {
  private vscode = vscode;
  private pendingRequests: Map<string, PendingRequest> = new Map();
  private updateHandlers: Map<string, (value: any) => any> = new Map();

  constructor() {
    this.setupListeners();
  }

  private setupListeners() {
    window.addEventListener('message', (event) => {
      const message = event.data;
      switch (message.type) {
        case 'update':
          if (message.name && this.updateHandlers.has(message.name)) {
            this.updateHandlers.get(message.name)!(message.value);
          }
          break;
        case 'response':
          if (
            message.requestId &&
            this.pendingRequests.has(message.requestId)
          ) {
            const { resolve, reject } = this.pendingRequests.get(
              message.requestId
            )!;
            if (message.error) {
              reject(message.error);
            } else {
              resolve(message?.value);
            }
            this.pendingRequests.delete(message.id);
          }
          break;
      }
    });
  }

  // Handle updates from the extension
  registerUpdateHandler<ReturnType>(
    name: string,
    handler: (value: ReturnType) => any
  ) {
    this.updateHandlers.set(name, handler);
  }

  // Send a request to the extension
  async request<ReturnType, ValueType = any>(
    name: string,
    value?: ValueType,
    timeout: number = DEFAULT_REQUEST_TIMEOUT
  ): Promise<ReturnType> {
    // Used to identify the corresponding response
    const requestId = Math.random().toString(36).substring(7);
    this.vscode.postMessage({ id: requestId, type: 'request', name, value });
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(requestId, { resolve, reject });
      // Set a timeout for the request
      setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(`${name} request timed out`);
      }, timeout);
    });
  }
}

// Singleton instance of the backend class
export const backend = new Backend();
