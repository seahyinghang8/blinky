import {
  VSCodeProgressRing,
  VSCodeTextField,
} from '@vscode/webview-ui-toolkit/react';
import { useEffect, useState } from 'react';
import { backend } from '../utils/backend';

import { ReproForm, ReproVals } from './repro/ReproForm';
import { ErrorBar } from './ErrorBar';

enum ButtonState {
  Send,
  Pause,
  Play,
}

export function UserInputAndControl({ isRunning }: { isRunning: boolean }) {
  const [inputText, setInputText] = useState('');
  const [hasStarted, setHasStarted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [reproVals, setReproVals] = useState<ReproVals>({
    buildCommand: '',
    testCommand: '',
    expectedInstruction: '',
    expectedStatus: '',
    expectedBody: '',
  });
  const [isExpanded, setIsExpanded] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    backend.request<ReproVals>('getReproVals').then((persistedRepro) => {
      setReproVals(persistedRepro);
    });

    backend.request<boolean>('hasStarted').then((hasStarted) => {
      setHasStarted(hasStarted);
    });

    backend.registerUpdateHandler<string>('errorMsg', (errorMsg) => {
      setErrorMsg(errorMsg);
    });
  }, []);

  useEffect(() => {
    if (!isRunning) {
      setLoading(false);
    }
  }, [isRunning]);

  async function sendMessage() {
    if (inputText.length === 0) {
      return;
    }
    await backend.request('updateVerificationSteps', reproVals);
    setIsExpanded(false);
    backend.request('userMessage', inputText);
    setInputText('');
    setHasStarted(true);
  }

  let placeholderText;
  if (isRunning) {
    placeholderText = 'Provide feedback to agent...';
  } else {
    placeholderText = 'Describe the task to the agent...';
  }

  let buttonState;
  if (inputText.length > 0 || !hasStarted) {
    buttonState = ButtonState.Send;
  } else if (isRunning) {
    buttonState = ButtonState.Pause;
  } else {
    buttonState = ButtonState.Play;
  }

  let inputButton;
  switch (buttonState) {
    case ButtonState.Send:
      const isDisabled = inputText.length === 0;
      inputButton = (
        <span
          slot='end'
          className='codicon codicon-send user-input-button'
          onClick={() => {
            sendMessage();
          }}
          aria-disabled={isDisabled}
        />
      );
      break;
    case ButtonState.Pause:
      inputButton = (
        <span
          slot='end'
          className='codicon codicon-debug-pause user-input-button pause'
          onClick={() => {
            setLoading(true);
            backend.request('stop');
          }}
        />
      );
      break;
    case ButtonState.Play:
      inputButton = (
        <span
          slot='end'
          className='codicon codicon-play user-input-button'
          onClick={() => {
            backend.request('start');
          }}
        />
      );
      break;
  }

  return (
    <div>
      {errorMsg.length > 0 && (
        <ErrorBar errorMsg={errorMsg} closeBar={() => setErrorMsg('')} />
      )}
      <ReproForm
        reproVals={reproVals}
        setReproVals={setReproVals}
        isExpanded={isExpanded}
        setIsExpanded={setIsExpanded}
      />
      <div style={{ padding: '10px 0' }}>
        <VSCodeTextField
          size={50}
          className='user-input'
          placeholder={placeholderText}
          value={inputText}
          onInput={(e: { target: any }) => setInputText(e.target.value)}
          onKeyDown={(e: { key: string }) => {
            if (e.key === 'Enter') {
              sendMessage();
            }
          }}
        >
          {loading ? (
            <span
              slot='end'
              className={'codicon codicon-loading user-input-loader'}
            />
          ) : (
            inputButton
          )}
        </VSCodeTextField>
      </div>
    </div>
  );
}
