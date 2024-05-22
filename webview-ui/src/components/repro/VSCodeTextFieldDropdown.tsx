import { useState } from 'react';
import {
  VSCodeDropdown,
  VSCodeOption,
  VSCodeTextField,
} from '@vscode/webview-ui-toolkit/react';

interface VSCodeTextFieldDropdownProps {
  value?: string;
  label?: string;
  placeholder?: string;
  options?: string[];
  position?: 'above' | 'below';
  style?: React.CSSProperties;
  onInput?: (value: string) => void;
}
export function VSCodeTextFieldDropdown({
  value = '',
  label = '',
  placeholder = '',
  options = [],
  position,
  style,
  onInput,
}: VSCodeTextFieldDropdownProps) {
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  const labelStyle: React.CSSProperties = {
    fontSize: 'calc(var(--vscode-editor-font-size) * 0.9)',
  };

  const textField = (
    <VSCodeTextField
      style={{
        ...style,
        width: '100%',
      }}
      size={50}
      placeholder={placeholder}
      value={value}
      onInput={(e: { target: any }) => {
        onInput && onInput(e.target.value);
      }}
    >
      <span style={labelStyle}>{label}</span>
      <span
        slot='end'
        className='codicon codicon-chevron-down'
        onClick={() => {
          setIsDropdownOpen(true);
        }}
      />
    </VSCodeTextField>
  );

  const dropdown = (
    <div className='dropdown-container' style={style}>
      <label className='label'>
        <span style={labelStyle}>{label}</span>
      </label>
      <VSCodeDropdown
        open={isDropdownOpen}
        position={position}
        value={value}
        onInput={(e: { target: any }) => {
          setIsDropdownOpen(false);
          onInput && onInput(e.target.value);
        }}
      >
        {!options.includes(value) && <VSCodeOption>{value}</VSCodeOption>}
        {options.map((option) => (
          <VSCodeOption key={option}>{option}</VSCodeOption>
        ))}
      </VSCodeDropdown>
    </div>
  );

  return isDropdownOpen ? dropdown : textField;
}
