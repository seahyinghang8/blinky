import { Action } from '../agents/types';
import { DiffState } from '../tools/utils';

export interface Config {
  state_template: string;
  command_docs: string;
  system_template: string;
  instance_template: string;
  next_step_template: string;
  next_step_no_output_template: string;
  format_error_template: string;
  demonstration_template?: string;
  post_reverted_diff_template: string;
  post_applied_diff_template: string;
  parse_function_name: string;
  parseFn: Function;
  demonstrations?: DemonstrationStep[];
  auxillary_vars: Object;
  done_function: string;
}

export interface State {}

export interface DemonstrationStep {
  role: 'agent' | 'user' | 'final-diff';
  content?: string;
  thought?: string;
  actions?: Action[];
  observations?: string[];
  wsDiffs?: {
    wsRoot: string;
    diffs: Record<string, DiffState>;
  };
}
