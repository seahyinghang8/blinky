import { VSCodeDivider } from '@vscode/webview-ui-toolkit/react';
import { backend } from '../utils/backend';
import { useEffect, useRef, useState } from 'react';
import { MessageContainer } from './MessageContainer';
import { ToolCall } from './ToolCall';
import { DiffState } from './diffs/DiffContainer';
import { AggregatedDiffView } from './diffs/AggregatedDiffView';

interface Action {
  toolName: string;
  params: string[];
}

export type MessageRole = 'agent' | 'user' | 'user-pending' | 'final-diff';

interface IMessage {
  id: string;
  role: MessageRole;
  text: string;
  actions?: Action[];
  observations?: string[];
  wsDiffs?: {
    wsRoot: string;
    diffs: Record<string, DiffState>;
  };
  curStreaming?: boolean; // whether the message is currently being streamed
}

const INIT_MESSAGE: IMessage = {
  id: 'init',
  role: 'agent',
  text: 'I am a debugging agent! To get started, type in your request below and provide the steps to repro the issue.',
  observations: ['Still processing...'],
};

const mostRecentDiffMsgId = (messages: IMessage[]) => {
  let i = messages.length - 1;
  while (i >= 0) {
    if (messages[i].wsDiffs) {
      return messages[i].id;
    }
    i--;
  }
  return -1;
};

export function MessageHistory({ isRunning }: { isRunning: boolean }) {
  const [messageHistory, setMessageHistory] = useState<IMessage[]>([]);
  const [autoscrollEnabled, setAutoscrollEnabled] = useState(true);
  const scrollDivRef = useRef<null | HTMLDivElement>(null);
  const scrollDivChildRef = useRef<null | HTMLDivElement>(null);
  const messagesEndRef = useRef<null | HTMLDivElement>(null);

  function isScrolledToNearBottom(): boolean {
    if (!scrollDivRef.current) {
      return false;
    }
    const element = scrollDivRef.current;
    // Check if the user has scrolled to the bottom
    const isNearBottom =
      Math.abs(
        element.scrollHeight - element.clientHeight - element.scrollTop
      ) < 50;
    // If the user has scrolled to the bottom
    return isNearBottom;
  }

  function scrollToBottom() {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }

  useEffect(() => {
    if (autoscrollEnabled) {
      scrollToBottom();
    }
  }, [messageHistory]);

  useEffect(() => {
    backend.request<IMessage[]>('messages', undefined).then((messages) => {
      setMessageHistory(messages);
      // if messages are empty, populate with a get started message
      if (messages.length === 0) {
        setMessageHistory([INIT_MESSAGE]);
      }
    });

    backend.registerUpdateHandler<IMessage[]>('messages', (messages) => {
      if (messages.length === 0) {
        setMessageHistory([INIT_MESSAGE]);
      } else {
        setMessageHistory(messages);
      }
    });

    backend.registerUpdateHandler<IMessage>('streamingMessage', (message) => {
      setMessageHistory((prevMessages) => {
        const newMessages = prevMessages.slice();
        if (newMessages.length > 0) {
          if (newMessages[newMessages.length - 1].curStreaming) {
            newMessages.pop();
          }
        }
        newMessages.push({ ...message, curStreaming: true });
        return newMessages;
      });
    });

    const observer = new ResizeObserver(() => {
      setAutoscrollEnabled(isScrolledToNearBottom());
    });

    if (
      scrollDivChildRef &&
      scrollDivChildRef.current &&
      scrollDivRef &&
      scrollDivRef.current
    ) {
      observer.observe(scrollDivChildRef.current);
      observer.observe(scrollDivRef.current);
    }

    return () => {
      // Clean up the handler when the component unmounts
      backend.registerUpdateHandler('messages', () => {});
      backend.registerUpdateHandler('streamingMessage', () => {});
      observer.disconnect();
    };
  }, []);

  return (
    <>
      <div
        ref={scrollDivRef}
        onScroll={() => {
          setAutoscrollEnabled(isScrolledToNearBottom());
        }}
        className='scrollbar-hide'
        style={{
          overflowY: 'auto',
          flexGrow: 1,
          width: '100%',
          position: 'relative',
        }}
      >
        <div ref={scrollDivChildRef}>
          {messageHistory.map((message) => {
            if (message.wsDiffs) {
              return (
                <div key={message.id}>
                  <AggregatedDiffView
                    fileDiffs={message.wsDiffs.diffs}
                    rootPath={message.wsDiffs.wsRoot}
                    summary={message.text}
                    key={message.id}
                    revertable={
                      mostRecentDiffMsgId(messageHistory) === message.id &&
                      !isRunning
                    }
                    isFinalMsg={
                      message.id ===
                      messageHistory[messageHistory.length - 1].id
                    }
                  />
                  <VSCodeDivider key={message.id} />
                </div>
              );
            }
            let toolCallTitle;
            if (message.actions) {
              toolCallTitle = message.actions
                .map(({ toolName, params }) => {
                  const paramStr = params
                    .map((param) => `"${param}"`)
                    .join(', ');
                  return `${toolName}(${paramStr})`;
                })
                .join('\n');
            }
            let toolCallOutput = '';
            if (message.observations) {
              toolCallOutput = message.observations.join(
                '\n----------------\n'
              );
            }
            // Show loading spinner for the first message if it is currently streaming
            // or if we're still at the initial message waiting for a response
            const loading =
              isRunning &&
              (message.curStreaming || messageHistory.length === 1);
            return (
              <div key={message.id}>
                <MessageContainer
                  key={message.id}
                  role={message.role}
                  childrenLoading={loading}
                >
                  <div style={{ lineHeight: 1.5, margin: '10px 0' }}>
                    {message.text}
                  </div>
                  {toolCallTitle && (
                    <ToolCall
                      title={toolCallTitle}
                      output={toolCallOutput}
                      loading={loading}
                    />
                  )}
                </MessageContainer>
                <VSCodeDivider key={message.id} />
              </div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>
      </div>
      <div style={{ position: 'relative', height: 0, width: '100%' }}>
        {!autoscrollEnabled && (
          <div
            style={{
              position: 'absolute',
              right: '20px',
              bottom: '6px',
            }}
          >
            <div
              style={{
                height: '25px',
                width: '25px',
                borderRadius: '50%',
                opacity: 0.6,
                color: 'var(--vscode-textBlockQuote-foreground)',
                background: 'var(--vscode-textBlockQuote-background)',
                border: '1px solid var(--vscode-textBlockQuote-border)',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                cursor: 'pointer',
              }}
              onClick={scrollToBottom}
              className='codicon codicon-arrow-down'
            />
          </div>
        )}
        <div
          style={{
            position: 'absolute',
            bottom: '0',
            width: '100%',
            height: '8px',
            backgroundImage:
              'linear-gradient(transparent, var(--panel-view-background))',
          }}
        />
      </div>
    </>
  );
}
