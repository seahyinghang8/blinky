import { useState } from 'react';
import { DiffEditor } from './DiffEditor';
import { VSCodeDivider } from '@vscode/webview-ui-toolkit/react';

export interface DiffState {
  initialText?: string;
  initialPath?: string;
  currentText?: string;
  currentPath?: string;
  created?: boolean;
  deleted?: boolean;
}

export interface IDiff {
  initialText?: string;
  initialPath?: string;
  currentText?: string;
  currentPath?: string;
  created?: boolean;
  deleted?: boolean;
}

export interface IDiffContainerProps {
  fileName: string;
  diff: IDiff;
}

export function DiffContainer({ fileName, diff }: IDiffContainerProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  let title = fileName;
  if (diff.created) {
    title = `Created: ${fileName}`;
  }
  if (diff.deleted) {
    title = `Deleted: ${fileName}`;
  }
  if (diff.initialText && diff.currentText) {
    title = `Modified: ${fileName}`;
  }
  if (diff.initialPath) {
    title = `Renamed: ${diff.initialPath} -> ${fileName}`;
  }

  const toggleExpanded = () => {
    setIsExpanded((oldExpandedState) => !oldExpandedState);
  };

  return (
    <div
      style={{
        border: '1px solid var(--vscode-textBlockQuote-border)',
        padding: '5px',
        marginBottom: '5px',
        width: '100%',
        boxSizing: 'border-box',
        borderRadius: '4px',
      }}
    >
      <div
        style={{
          flexDirection: 'row',
          display: 'flex',
          alignItems: 'center',
          width: '100%',
          cursor: 'pointer',
        }}
        onClick={toggleExpanded}
      >
        <div
          className={`codicon ${
            isExpanded ? 'codicon-chevron-down' : 'codicon-chevron-right'
          }`}
        />
        <div
          style={{
            color: 'var(--vscode-foreground)',
            fontSize: 'var(--vscode-textLink-foreground)',
            fontStyle: 'italic',
            overflowX: 'auto',
            whiteSpace: 'pre',
            lineHeight: 1.3,
            marginLeft: '4px',
          }}
        >
          {title}
        </div>
      </div>
      {isExpanded && (
        <>
          <VSCodeDivider role='presentation'></VSCodeDivider>
          <DiffEditor
            modifiedText={diff.currentText || ''}
            originalText={diff.initialText || ''}
          />
        </>
      )}
    </div>
  );
}
