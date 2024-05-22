import { VSCodeProgressRing } from '@vscode/webview-ui-toolkit/react';
import { MessageRole } from './MessageHistory';
import { GhostSvg, UserSvg, DiffSvg } from './Svg';
import { PropsWithChildren, ReactElement } from 'react';

interface IMessageContainerProps {
  role: MessageRole;
  controlButtons?: ReactElement;
  controlLoading?: boolean;
  childrenLoading?: boolean;
}

export function MessageContainer({
  role,
  controlButtons,
  controlLoading,
  children,
  childrenLoading,
}: PropsWithChildren<IMessageContainerProps>) {
  let icon = <GhostSvg height={12} width={12} strokeWidth={2.5} />;
  if (role === 'agent') {
    icon = <GhostSvg height={12} width={12} strokeWidth={2.5} />;
  } else if (role === 'user') {
    icon = <UserSvg height={12} width={12} strokeWidth={2.5} />;
  } else if (role === 'final-diff') {
    icon = <DiffSvg height={12} width={12} strokeWidth={2.5} />;
  }
  let messageAuthor;
  switch (role) {
    case 'agent':
      messageAuthor = 'Agent';
      break;
    case 'user':
      messageAuthor = 'You';
      break;
    case 'user-pending':
      messageAuthor = 'You';
      break;
    case 'final-diff':
      messageAuthor = 'Changes';
      break;
  }

  const containerStyle: React.CSSProperties = {
    padding: '6px 20px',
    width: '100%',
    boxSizing: 'border-box',
  };

  const isPending = role === 'user-pending';
  if (isPending) {
    containerStyle.color = 'var(--vscode-descriptionForeground)';
  }

  return (
    <div style={containerStyle}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '8px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center' }}>
          {icon}
          <div
            style={{
              textTransform: 'uppercase',
              marginLeft: '6px',
              fontSize: '0.9em',
              fontWeight: '600',
            }}
          >
            {messageAuthor}
          </div>
          {childrenLoading && (
            <VSCodeProgressRing style={{ height: '14px' }}></VSCodeProgressRing>
          )}
        </div>
        {controlButtons && !controlLoading && controlButtons}
        {controlButtons && controlLoading && (
          <VSCodeProgressRing style={{ height: '18px' }}></VSCodeProgressRing>
        )}
        <div></div>
      </div>
      <div>{children}</div>
      {isPending && (
        <div style={{ fontSize: '0.8em' }}>
          (This message will be incoporated by the agent in the next step)
        </div>
      )}
    </div>
  );
}
