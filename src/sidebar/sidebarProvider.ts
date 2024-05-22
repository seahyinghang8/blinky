import {
  CancellationToken,
  Uri,
  Webview,
  WebviewView,
  WebviewViewProvider,
  WebviewViewResolveContext,
  type Disposable,
} from 'vscode';

export class ChatSidebarProvider implements WebviewViewProvider {
  private disposables: Disposable[] = [];
  private requestHandlers: Map<string, (args: any) => Promise<any>> = new Map();
  private webview?: Webview;

  constructor(private readonly _extensionUri: Uri) {}

  resolveWebviewView(
    webviewView: WebviewView,
    context: WebviewViewResolveContext,
    token: CancellationToken
  ) {
    webviewView.webview.options = {
      enableScripts: true,
    };
    webviewView.webview.html = this.getWebviewContent(webviewView.webview);
    this.setWebviewMessageListener(webviewView.webview);
    this.webview = webviewView.webview;
  }

  registerRequestHandler(name: string, handler: (value: any) => any) {
    this.requestHandlers.set(name, handler);
  }

  sendUpdate(name: string, value: any) {
    // Send a one-way update to the webview
    this.webview?.postMessage({ type: 'update', name, value });
  }

  /**
   * Cleans up and disposes of webview resources when the webview panel is closed.
   */
  dispose() {
    // Dispose of all disposables (i.e. commands) for the current webview panel
    while (this.disposables.length) {
      const disposable = this.disposables.pop();
      if (disposable) {
        disposable.dispose();
      }
    }
  }

  /**
   * Defines and returns the HTML that should be rendered within the webview panel.
   *
   * @remarks This is also the place where references to the React webview build files
   * are created and inserted into the webview HTML.
   *
   * @param webview A reference to the extension webview
   * @param extensionUri The URI of the directory containing the extension
   * @returns A template string literal containing the HTML that should be
   * rendered within the webview panel
   */
  private getWebviewContent(webview: Webview) {
    // CSS file for codicon
    const codiconsUri = getUri(webview, this._extensionUri, [
      'assets',
      'codicon',
      'codicon.css',
    ]);
    const stylesUri = getUri(webview, this._extensionUri, [
      'webview-ui',
      'build',
      'assets',
      'index.css',
    ]);
    // The JS file from the React build output
    const scriptUri = getUri(webview, this._extensionUri, [
      'webview-ui',
      'build',
      'assets',
      'index.js',
    ]);

    const nonce = getNonce();
    // Tip: Install the es6-string-html VS Code extension to enable code highlighting below
    return /*html*/ `
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <meta http-equiv="Content-Security-Policy" content="default-src 'none'; font-src ${webview.cspSource}; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
          <link rel="stylesheet" type="text/css" href="${stylesUri}" />
          <link rel="stylesheet" type="text/css" href="${codiconsUri}" />
          <title>Extension</title>
        </head>
        <body>
          <div id="root"></div>
          <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
        </body>
      </html>
    `;
  }

  /**
   * Sets up an event listener to listen for messages passed from the webview context and
   * executes code based on the message that is recieved.
   *
   * @param webview A reference to the extension webview
   */
  private setWebviewMessageListener(webview: Webview) {
    webview.onDidReceiveMessage(
      async (request: { name: string; value: any; id: string }) => {
        const handler = this.requestHandlers.get(request.name);
        if (handler) {
          const result = await handler(request.value);
          webview.postMessage({
            type: 'response',
            requestId: request.id,
            value: result,
          });
        } else {
          webview.postMessage({
            id: request.id,
            error: `No handler found for request: ${request.name}`,
          });
        }
      },
      undefined,
      this.disposables
    );
  }
}

/**
 * A helper function that returns a unique alphanumeric identifier called a nonce.
 *
 * @remarks This function is primarily used to help enforce content security
 * policies for resources/scripts being executed in a webview context.
 *
 * @returns A nonce
 */
export function getNonce() {
  let text = '';
  const possible =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

/**
 * A helper function which will get the webview URI of a given file or resource.
 *
 * @remarks This URI can be used within a webview's HTML as a link to the
 * given file/resource.
 *
 * @param webview A reference to the extension webview
 * @param extensionUri The URI of the directory containing the extension
 * @param pathList An array of strings representing the path to a file/resource
 * @returns A URI pointing to the file/resource
 */
export function getUri(
  webview: Webview,
  extensionUri: Uri,
  pathList: string[]
) {
  return webview.asWebviewUri(Uri.joinPath(extensionUri, ...pathList));
}
