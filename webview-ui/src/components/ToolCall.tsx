import { VSCodeProgressRing } from '@vscode/webview-ui-toolkit/react';
import { useState } from 'react';

export interface IToolCallProps {
  title: string;
  output: string;
  loading?: boolean;
}

export function ToolCall({ title, output, loading }: IToolCallProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div
      style={{
        border: '1px solid var(--vscode-textBlockQuote-border)',
        fontSize: 'var(--vscode-editor-font-size)',
        borderRadius: '4px',
      }}
    >
      <div
        className='tool-call-title-container'
        onClick={() => setIsExpanded((oldExpandedState) => !oldExpandedState)}
      >
        <div
          className={`codicon ${
            loading || isExpanded
              ? 'codicon-chevron-down'
              : 'codicon-chevron-right'
          }`}
        />
        <div
          className='scrollbar-hide'
          style={{
            overflowX: 'auto',
            whiteSpace: 'pre',
            lineHeight: 1.3,
            marginLeft: '4px',
          }}
        >
          {title}
        </div>
        {loading && (
          <VSCodeProgressRing style={{ height: '10px' }}></VSCodeProgressRing>
        )}
      </div>
      {(loading || isExpanded) && (
        <div
          className='scrollbar-hide'
          style={{
            whiteSpace: 'pre',
            fontFamily: 'var(--vscode-editor-font-family)',
            lineHeight: 1.4,
            borderTop: '1px solid var(--vscode-textBlockQuote-border)',
            borderRadius: '0 0 4px 4px',
            color: 'var(--vscode-textBlockQuote-foreground)',
            background: 'var(--vscode-textBlockQuote-background)',
            padding: '6px 8px',
            overflowX: 'auto',
          }}
        >
          {output}
        </div>
      )}
    </div>
  );
}
