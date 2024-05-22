import { VSCodeButton } from '@vscode/webview-ui-toolkit/react';

export function ErrorBar({
  errorMsg,
  closeBar,
}: {
  errorMsg: string;
  closeBar: () => void;
}) {
  return (
    <div
      style={{
        border: '1px solid var(--vscode-editorError-foreground)',
        fontSize: 'var(--vscode-editor-font-size)',
        borderRadius: '4px',
        padding: '10px',
        display: 'flex',
        marginBottom: '8px',
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          color: 'var(--vscode-editorError-foreground)',
        }}
      >
        <div
          style={{
            textTransform: 'uppercase',
            fontSize: '0.9em',
            fontWeight: '600',
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            cursor: 'pointer',
            marginRight: '8px',
          }}
        >
          <div
            className={`codicon codicon-warning`}
            style={{ marginRight: '2px' }}
          />
          Error
        </div>
        {errorMsg}
      </div>
      <VSCodeButton appearance='icon' onClick={closeBar}>
        <span className='codicon codicon-check'></span>
      </VSCodeButton>
    </div>
  );
}
