import { DiffContainer, IDiff } from './DiffContainer';
import { MessageContainer } from '../MessageContainer';
import { VSCodeTag, VSCodeButton } from '@vscode/webview-ui-toolkit/react';

import { backend } from '../../utils/backend';
import { useEffect, useState } from 'react';

export const TEST_DIFF = {
  'test.py': {
    initialText: "print('Hello, world!')",
    initialPath: 'test.py',
    currentText:
      "print('Hello, World!')\nprint('Hello, World!')\nprint('Hello, World!')\nprint('Hello, World!')\nprint('Hello, World!')\nprint('Hello, World!')\nprint('Hello, World!')\nprint('Hello, World!')\nprint('Hello, World!')\nprint('Hello, World!')\nprint('Hello, World!')\nprint('Hello, World!')\nprint('Hello, World!')\nprint('Hello, World!')\n",
    currentPath: 'test.py',
    created: false,
    deleted: false,
  },
  'test2.py': {
    currentText: "print('Hello, World!')",
    created: true,
  },
  'test3.py': {
    initialText: "print('Hello, world!')",
    initialPath: 'test1.py',
    currentText: "print('Hello, World!')",
    currentPath: 'test3.py',
  },
  'test4.py': {
    deleted: true,
  },
};

export interface IDiffContainerProps {
  fileDiffs: Record<string, IDiff>;
  rootPath?: string;
  revertable: boolean;
  isFinalMsg?: boolean;
  summary: string;
}

export function AggregatedDiffView({
  fileDiffs,
  rootPath,
  revertable,
  summary,
}: IDiffContainerProps) {
  const [loading, setLoading] = useState(false);
  const [applied, setApplied] = useState(true);

  useEffect(() => {
    backend.request<boolean>('diffApplied').then((diffApplied) => {
      setApplied(diffApplied);
    });
  }, []);

  const undoFn = async () => {
    setLoading(true);
    await backend.request('undo');
    setLoading(false);
    setApplied(false);
  };
  const applyFn = async () => {
    setLoading(true);
    await backend.request('redo');
    setLoading(false);
    setApplied(true);
  };
  const controlButtons = (
    <div style={{ display: 'flex', flexGrow: '2', justifyContent: 'flex-end' }}>
      {applied ? (
        <VSCodeButton
          appearance='icon'
          aria-label='Undo'
          onClick={undoFn}
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '2px',
          }}
        >
          <span
            className='codicon codicon-error'
            style={{
              color: 'var(--vscode-errorForeground)',
            }}
          ></span>
          <span
            style={{
              paddingLeft: '2px',
              fontSize: '12px',
              alignItems: 'center',
              display: 'inline-flex',
              width: '100%',
              color: 'var(--vscode-errorForeground)',
            }}
          >
            Revert
          </span>
        </VSCodeButton>
      ) : (
        <VSCodeButton
          appearance='icon'
          aria-label='Confirm'
          onClick={applyFn}
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '2px',
          }}
        >
          <span
            className='codicon codicon-add'
            style={{
              color: 'var(--vscode-editorLightBulbAutoFix-foreground)',
            }}
          ></span>
          <span
            style={{
              paddingLeft: '2px',
              fontSize: '12px',
              alignItems: 'center',
              display: 'inline-flex',
              width: '100%',
              color: 'var(--vscode-editorLightBulbAutoFix-foreground)',
            }}
          >
            Apply
          </span>
        </VSCodeButton>
      )}
    </div>
  );
  return (
    <MessageContainer
      role='final-diff'
      controlLoading={loading}
      controlButtons={revertable ? controlButtons : <></>}
    >
      {applied ? (
        <VSCodeTag style={{ marginBottom: '5px' }}>Change Applied</VSCodeTag>
      ) : (
        <VSCodeTag style={{ marginBottom: '5px' }}>
          Changes NOT Applied
        </VSCodeTag>
      )}
      <div style={{ lineHeight: 1.5, margin: '10px 0' }}>{summary}</div>
      {Object.keys(fileDiffs).map((fileName) => {
        let relativeName = fileName;
        if (rootPath) {
          relativeName = fileName.substring(rootPath.length);
        }
        return (
          <DiffContainer
            key={fileName}
            fileName={relativeName}
            diff={fileDiffs[fileName]}
          />
        );
      })}
    </MessageContainer>
  );
}
