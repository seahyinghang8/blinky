import { useRef, useState, useEffect } from 'react';
import '../../userWorker';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';

interface IDiffEditorProps {
  originalText: string;
  modifiedText: string;
}

const MIN_HEIGHT = 50;

export const DiffEditor = ({
  originalText,
  modifiedText,
}: IDiffEditorProps) => {
  const [editor, setEditor] =
    useState<monaco.editor.IStandaloneDiffEditor | null>(null);
  const [height, setHeight] = useState(MIN_HEIGHT);
  const monacoEl = useRef<null | HTMLDivElement>(null);
  useEffect(() => {
    if (monacoEl) {
      setEditor((editor) => {
        if (editor) {
          return editor;
        }
        const originalModel = monaco.editor.createModel(
          originalText,
          'javascript'
        );
        const modifiedModel = monaco.editor.createModel(
          modifiedText,
          'javascript'
        );

        const diffEditor = monaco.editor.createDiffEditor(monacoEl.current!, {
          originalEditable: false,
          renderSideBySide: true,
          hideUnchangedRegions: { enabled: true },
          readOnly: true,
          scrollBeyondLastLine: false,
          renderOverviewRuler: false,
          folding: false,
          isInEmbeddedEditor: true,
          theme: 'vs-dark',
          //onlyShowAccessibleDiffViewer: true,
          fontSize: 10,
        });
        diffEditor.setModel({
          original: originalModel,
          modified: modifiedModel,
        });
        diffEditor.onDidUpdateDiff(() => {
          const height = diffEditor.getOriginalEditor().getContentHeight();
          setHeight(Math.max(height, MIN_HEIGHT));
          diffEditor.focus();
        });
        return diffEditor;
      });
    }
    return () => editor?.dispose();
  }, [monacoEl.current]);

  useEffect(() => {
    if (editor) {
      editor.layout();
      // hack to scroll down.
      setTimeout(
        () => monacoEl.current?.scrollIntoView({ behavior: 'smooth' }),
        350
      );
    }
  }, [height]);

  return <div style={{ height: `${height}px` }} ref={monacoEl}></div>;
};
