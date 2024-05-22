import { Config } from './types';
import { PARSER_REGISTRY } from '../agents/parsers';
import configYaml from './default.yaml';

export function loadConfig(): Config | null {
  try {
    let yamlData = configYaml as Config;
    yamlData.parseFn = PARSER_REGISTRY[yamlData.parse_function_name];
    if (!yamlData.parseFn) {
      throw Error('Config parse_function_name not recognized');
    }
    return yamlData;
  } catch (error) {
    console.error('Error reading or parsing YAML:', error);
  }
  return null;
}
