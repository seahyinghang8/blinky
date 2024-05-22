import { useEffect, useState } from 'react';
import { backend } from '../../utils/backend';
import { ExpectedOuputPanels } from './ExpectedOuputPanels';
import { VSCodeTextFieldDropdown } from './VSCodeTextFieldDropdown';
import { VSCodeLink } from '@vscode/webview-ui-toolkit/react';

export interface ReproVals {
  buildCommand: string;
  testCommand: string;
  expectedInstruction: string;
  expectedStatus: string;
  expectedBody: string;
}

const PULL_COMMANDS = '... Fetch recent terminal commands ...';

interface ReproFormProps {
  reproVals: ReproVals;
  setReproVals: (reproVals: ReproVals) => void;
  isExpanded: boolean;
  setIsExpanded: React.Dispatch<React.SetStateAction<boolean>>;
}

export function ReproForm({
  reproVals,
  setReproVals,
  isExpanded,
  setIsExpanded,
}: ReproFormProps) {
  const [shellHistory, setShellHistory] = useState<string[]>([]);

  useEffect(() => {
    backend.request<string[]>('shellHistory').then(setShellHistory);
    backend.registerUpdateHandler<string[]>('shellHistory', setShellHistory);
  }, []);

  return (
    <div>
      <div
        style={{
          textTransform: 'uppercase',
          userSelect: 'none',
          fontSize: 'var(--vscode-editor-font-size)',
          fontWeight: '500',
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          cursor: 'pointer',
          paddingTop: isExpanded ? '8px' : '4px',
          color: 'var(--vscode-pickerGroup-foreground)',
          gap: '2px',
        }}
        onClick={() => setIsExpanded((oldExpandedState) => !oldExpandedState)}
      >
        <div
          className={`codicon ${
            isExpanded ? 'codicon-chevron-down' : 'codicon-chevron-right'
          }`}
          style={{ marginLeft: '-5px' }}
        />
        Specify Repro Steps
      </div>
      {isExpanded && (
        <div
          style={{
            marginTop: '8px',
          }}
        >
          <VSCodeTextFieldDropdown
            placeholder='e.g. npm run dev'
            label='Build Command'
            options={[...shellHistory, PULL_COMMANDS]}
            position='below'
            style={{ marginBottom: '8px' }}
            value={reproVals.buildCommand}
            onInput={async (value: string) => {
              if (value === PULL_COMMANDS) {
                await backend.request('pushActiveTerminalShellHistory');
              } else {
                setReproVals({ ...reproVals, buildCommand: value });
              }
            }}
          />
          <VSCodeTextFieldDropdown
            placeholder='e.g. curl localhost:3000/api/test'
            label='Test Command'
            options={[...shellHistory, PULL_COMMANDS]}
            position='below'
            value={reproVals.testCommand}
            style={{ marginBottom: '8px' }}
            onInput={async (value: string) => {
              if (value === PULL_COMMANDS) {
                await backend.request('pushActiveTerminalShellHistory');
              } else {
                setReproVals({ ...reproVals, testCommand: value });
              }
            }}
          />
          <ExpectedOuputPanels
            reproVals={reproVals}
            setReproVals={setReproVals}
          />
          <VSCodeLink
            href='#'
            style={{
              fontSize: 'calc(var(--vscode-editor-font-size) * 0.9)',
            }}
            onClick={() => backend.request('openReproSettings')}
          >
            Advanced Settings
          </VSCodeLink>
        </div>
      )}
    </div>
  );
}
