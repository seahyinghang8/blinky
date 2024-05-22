import { existsSync } from 'fs';
import { Uri, env } from 'vscode';

export function ripgrepPath(): string {
  const isWin = /^win/.test(process.platform);
  const exeName = isWin ? 'rg.exe' : 'rg';
  const appRootUri = Uri.parse(env.appRoot);

  const path1 = Uri.joinPath(
    appRootUri,
    'node_modules/vscode-ripgrep/bin/',
    exeName
  );
  if (existsSync(path1.fsPath)) {
    return path1.path;
  }

  const path2 = Uri.joinPath(
    appRootUri,
    'node_modules.asar.unpacked/vscode-ripgrep/bin/',
    exeName
  );
  if (existsSync(path2.fsPath)) {
    return path2.path;
  }

  const path3 = Uri.joinPath(
    appRootUri,
    'node_modules/@vscode/ripgrep/bin/',
    exeName
  );
  if (existsSync(path3.fsPath)) {
    return path3.path;
  }

  const path4 = Uri.joinPath(
    appRootUri,
    'node_modules.asar.unpacked/@vscode/ripgrep/bin/',
    exeName
  );
  if (existsSync(path4.fsPath)) {
    return path4.path;
  }

  throw Error('vscode-ripgrep executable cannot be found.');
}
