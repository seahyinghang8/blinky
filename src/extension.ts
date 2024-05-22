import * as vscode from 'vscode';
import { Coordinator } from './coordinator';
import { VanillaAgent } from './agents/agent';
import { Toolbox } from './tools/toolbox';
import { loadConfig } from './config/utils';

import { Verifier } from './tools/verifier';
import { ChatSidebarProvider } from './sidebar/sidebarProvider';

let coordinator: Coordinator | undefined;
// Called once the very first time the extension is activated
export async function activate(context: vscode.ExtensionContext) {
  const toolbox = new Toolbox();
  const config = loadConfig();
  if (config === null) {
    console.error('Error loading config');
    return;
  }
  const verifier = new Verifier();
  const agent = new VanillaAgent(config);
  const chatSidebarProvider = new ChatSidebarProvider(context.extensionUri);
  // Register the Chat Sidebar Panel
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      'blinky-chat',
      chatSidebarProvider
    )
  );
  const coordinator = new Coordinator(
    agent,
    toolbox,
    verifier,
    chatSidebarProvider
  );
  coordinator.initialize();
  // Register the commands
  context.subscriptions.push(
    vscode.commands.registerCommand('blinky.openSettings', () => {
      vscode.commands.executeCommand('workbench.action.openSettings', 'blinky');
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('blinky.resetProgress', () => {
      coordinator.resetProgress();
    })
  );
}

// Extension is deactivated
export function deactivate() {
  if (coordinator !== undefined) {
    coordinator.endLoop();
  }
}
