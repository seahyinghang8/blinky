// Serialization of types for prompt interpolation
import { DemonstrationStep } from '../config/types';
import { Toolbox, toolSignature } from '../tools/toolbox';

export function serializeDemonstrations(demonstrations: DemonstrationStep[]) {
  // Serialize demonstrations for interpolation as one string with each step separated by a newline
  return demonstrations
    .map((step) => {
      return Object.entries(step)
        .map(([key, value]) => {
          // Only if key is role or content
          if (key === 'role' || key === 'content') {
            return `${key}: ${value}`;
          }
        })
        .join('\n');
    })
    .join('\n\n');
}

export function serializeTools(toolbox: Toolbox): string {
  // Serialize tools for interpolation as one string with each command separated by a newline
  const serializedTools = Object.values(toolbox.tools)
    .map((tool) => {
      return toolSignature(tool);
    })
    .join('\n\n');
  return serializedTools;
}
