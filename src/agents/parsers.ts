import { FormatError } from '../errors';
import { parseAction } from '../tools/utils';
import { ForwardStep } from './types';

export function thoughtActionParser(
  response: string,
  stream?: boolean // handle parsing semi-complete streamed responses
): ForwardStep {
  const functionStart = '<function>';
  const regex = /<function>([^<]*)<\/function>/g;
  const separatorIndex = response.indexOf(functionStart);
  const thoughtStart = 'DISCUSSION';
  if (separatorIndex === -1 && !stream) {
    throw new FormatError('No action separator found in response.');
  } else if (separatorIndex === -1 && stream) {
    let thought = response.trim();
    if (thought.startsWith(thoughtStart)) {
      thought = thought.slice(thoughtStart.length).trim();
    }
    return { thought: thought, actions: [], output: response };
  }

  let thought = response.slice(0, separatorIndex).trim();
  if (thought.startsWith(thoughtStart)) {
    thought = thought.slice(thoughtStart.length).trim();
  }
  let actionSegment = response.slice(separatorIndex);

  if (stream) {
    let functionOpenTags = (actionSegment.match(/<function>/g) || []).length;
    let functionCloseTags = (actionSegment.match(/<\/function>/g) || []).length;
    if (functionOpenTags > functionCloseTags) {
      actionSegment += '</function>';
    }
  }

  const actions = [];
  let match;
  while ((match = regex.exec(actionSegment)) !== null) {
    try {
      actions.push(parseAction(match[1].trim(), stream));
    } catch (e) {
      if (stream) {
        continue;
      }
      throw new FormatError('Error parsing action');
    }
  }
  return { thought, actions, output: response };
}

export const PARSER_REGISTRY: Record<string, Function> = {
  thoughtActionParser: thoughtActionParser,
};
