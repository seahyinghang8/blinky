import {
  VSCodeTextField,
  VSCodeTextArea,
  VSCodePanelView,
  VSCodePanelTab,
  VSCodePanels,
} from '@vscode/webview-ui-toolkit/react';
import { ReproVals } from './ReproForm';

interface ExpectedOuputPanelsProps {
  reproVals: ReproVals;
  setReproVals: (reproVals: ReproVals) => void;
}
export function ExpectedOuputPanels({
  reproVals,
  setReproVals,
}: ExpectedOuputPanelsProps) {
  return (
    <VSCodePanels>
      <VSCodePanelTab id='tab-1'>
        <span
          style={{
            fontSize: 'calc(var(--vscode-editor-font-size) * 0.85)',
          }}
        >
          Free Form Output
        </span>
      </VSCodePanelTab>
      <VSCodePanelTab id='tab-2'>
        <span
          style={{
            fontSize: 'calc(var(--vscode-editor-font-size) * 0.85)',
          }}
        >
          Structured Output
        </span>
      </VSCodePanelTab>
      <VSCodePanelView id='view-1'>
        <div>
          <VSCodeTextArea
            placeholder='e.g. status should be 200 and the name should be "Fargo"'
            cols={100}
            rows={3}
            value={reproVals.expectedInstruction}
            onInput={(e: { target: any }) =>
              setReproVals({
                ...reproVals,
                expectedInstruction: e.target.value,
              })
            }
          >
            <span
              style={{
                fontSize: 'calc(var(--vscode-editor-font-size) * 0.9)',
              }}
            >
              Instructions
            </span>
          </VSCodeTextArea>
          <TextAreaHelperText>
            Tell the agent what to look for in the output
          </TextAreaHelperText>
        </div>
      </VSCodePanelView>
      <VSCodePanelView id='view-2'>
        <div>
          <VSCodeTextField
            placeholder='e.g. 200'
            style={{ marginBottom: '8px', width: '100%' }}
            value={reproVals.expectedStatus}
            onInput={(e: { target: any }) =>
              setReproVals({ ...reproVals, expectedStatus: e.target.value })
            }
          >
            <span
              style={{
                fontSize: 'calc(var(--vscode-editor-font-size) * 0.9)',
              }}
            >
              HTTP Status Code
            </span>
          </VSCodeTextField>
          <VSCodeTextArea
            placeholder='e.g. { "name": "Fargo" }'
            cols={100}
            rows={3}
            value={reproVals.expectedBody}
            onInput={(e: { target: any }) =>
              setReproVals({ ...reproVals, expectedBody: e.target.value })
            }
          >
            <span
              style={{
                fontSize: 'calc(var(--vscode-editor-font-size) * 0.9)',
              }}
            >
              JSON Body
            </span>
          </VSCodeTextArea>
          <TextAreaHelperText>
            Specify only parts of the response that should match
          </TextAreaHelperText>
        </div>
      </VSCodePanelView>
    </VSCodePanels>
  );
}

function TextAreaHelperText({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        fontSize: 'calc(var(--vscode-editor-font-size) * 0.8)',
      }}
    >
      {children}
    </span>
  );
}
